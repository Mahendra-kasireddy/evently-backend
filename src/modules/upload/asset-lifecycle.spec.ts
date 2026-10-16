import { readFileSync } from 'fs';
import { join } from 'path';
import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Types } from 'mongoose';
import type { Connection, Model } from 'mongoose';
import sharp from 'sharp';
import { v2 as cloudinary } from 'cloudinary';

import { UploadService } from './upload.service';
import { UploadPurpose } from './upload.constants';
import { AssetLifecycleService, MAX_DELETE_ATTEMPTS } from './asset-lifecycle.service';
import { MediaAsset, MediaAssetStatus } from './schemas/media-asset.schema';
import { findReference, ReferenceDb } from './asset-references';
import { assertCleanupAllowed, describeRun, parseCleanupArgs } from './asset-cleanup.guard';
import { UserService } from '../user/user.service';

/* Cloudinary is mocked at the SDK: nothing in this file reaches a real account. */
jest.mock('cloudinary', () => ({
  v2: {
    config: jest.fn(),
    uploader: { upload_stream: jest.fn(), upload_chunked_stream: jest.fn(), destroy: jest.fn() },
    api: { resources: jest.fn() },
  },
}));
const sdk = cloudinary.uploader as unknown as {
  upload_stream: jest.Mock;
  destroy: jest.Mock;
};

/* ------------------------------------------------------------------ fakes */

type Doc = Record<string, any>;

/** The few operators the services use, over plain objects. */
function matches(doc: Doc, filter: Doc): boolean {
  return Object.entries(filter).every(([k, cond]) => {
    if (k === '$or') return (cond as Doc[]).some((f) => matches(doc, f));
    const v = doc[k];
    if (cond && typeof cond === 'object' && !(cond instanceof Types.ObjectId)) {
      if ('$in' in cond) return (cond.$in as unknown[]).some((x) => String(x) === String(v));
      if ('$lt' in cond) return v != null && v < cond.$lt;
    }
    return String(v) === String(cond);
  });
}

function apply(doc: Doc, update: Doc): void {
  for (const [k, v] of Object.entries(update)) {
    if (k === '$inc') for (const [f, n] of Object.entries(v as Doc)) doc[f] = (doc[f] ?? 0) + n;
    else doc[k] = v;
  }
}

const query = <T>(value: T) => {
  const q = { exec: () => Promise.resolve(value), lean: () => q };
  return q;
};

/** An in-memory `media_assets`. */
class FakeAssets {
  docs: Doc[] = [];
  create(data: Doc): Promise<Doc> {
    const doc = {
      _id: new Types.ObjectId(),
      status: MediaAssetStatus.ACTIVE,
      deleteAttempts: 0,
      lastError: '',
      createdAt: new Date(Date.now() - 48 * 3600_000),
      ...data,
    };
    this.docs.push(doc);
    return Promise.resolve(doc);
  }
  findOne(filter: Doc) {
    return query(this.docs.find((d) => matches(d, filter)) ?? null);
  }
  findById(id: string) {
    return query(this.docs.find((d) => String(d._id) === String(id)) ?? null);
  }
  find(filter: Doc) {
    let list = this.docs.filter((d) => matches(d, filter));
    const chain = {
      sort: () => chain,
      lean: () => chain,
      limit: (n: number) => ((list = list.slice(0, n)), chain),
      exec: () => Promise.resolve(list),
    };
    return chain;
  }
  findOneAndUpdate(filter: Doc, update: Doc) {
    const doc = this.docs.find((d) => matches(d, filter));
    if (doc) apply(doc, update);
    return query(doc ?? null);
  }
  updateOne(filter: Doc, update: Doc) {
    const doc = this.docs.find((d) => matches(d, filter));
    if (doc) apply(doc, update);
    return query({});
  }
}

/** Every value at a dotted path, through arrays (as MongoDB matches them). */
function valuesAt(node: unknown, path: string[]): unknown[] {
  if (!path.length) return Array.isArray(node) ? node : [node];
  if (Array.isArray(node)) return node.flatMap((n) => valuesAt(n, path));
  if (!node || typeof node !== 'object') return [];
  return valuesAt((node as Doc)[path[0]], path.slice(1));
}

/** A database holding whatever documents a test puts in it. */
function referenceDb(collections: Record<string, Doc[]>, failing?: string): ReferenceDb {
  return {
    collection: (name: string) => ({
      findOne: async (filter: Doc) => {
        if (name === failing) throw new Error('connection reset');
        const docs = collections[name] ?? [];
        return (
          docs.find((d) =>
            (filter.$or as Doc[]).some((c) => {
              const [path, cond] = Object.entries(c)[0];
              return valuesAt(d, path.split('.')).some((v) => cond.$in.includes(v));
            }),
          ) ?? null
        );
      },
      find: () => ({ toArray: async () => collections[name] ?? [] }),
    }),
  };
}

const ALICE = new Types.ObjectId().toString();
const BOB = new Types.ObjectId().toString();

function setup(collections: Record<string, Doc[]> = {}, failing?: string) {
  const assets = new FakeAssets();
  const values: Record<string, unknown> = {
    'upload.driver': 'cloudinary',
    'upload.cloudinary.cloudName': 'demo',
    'upload.cloudinary.apiKey': 'key',
    'upload.cloudinary.apiSecret': 'secret',
    'upload.cloudinary.folder': 'evently',
  };
  const config = {
    get: (k: string, f?: unknown) => (k in values ? values[k] : f),
  } as unknown as ConfigService;
  const model = assets as unknown as Model<MediaAsset>;
  const uploads = new UploadService(config, model);
  uploads.onModuleInit();
  const lifecycle = new AssetLifecycleService(
    model,
    { db: referenceDb(collections, failing) } as unknown as Connection,
    uploads,
  );
  return { assets, uploads, lifecycle, collections };
}

/** A tracked upload, as UploadService records one. */
async function tracked(
  assets: FakeAssets,
  over: Partial<{ owner: string | null; resourceType: string; ext: string }> = {},
) {
  const ext = over.ext ?? 'png';
  const id = new Types.ObjectId().toString();
  const key = `profileImage/2026/10/${id}.${ext}`;
  const publicId = `evently/profileImage/2026/10/${id}`;
  return assets.create({
    key,
    url: `https://res.cloudinary.com/demo/image/upload/v1/${publicId}.${ext}`,
    provider: 'cloudinary',
    publicId,
    resourceType: over.resourceType ?? 'image',
    purpose: 'profileImage',
    owner: over.owner === null ? null : new Types.ObjectId(over.owner ?? ALICE),
  });
}

let png: Buffer;
beforeAll(async () => {
  png = await sharp({
    create: { width: 300, height: 300, channels: 3, background: { r: 10, g: 20, b: 30 } },
  })
    .png()
    .toBuffer();
});

beforeEach(() => {
  jest.clearAllMocks();
  sdk.destroy.mockResolvedValue({ result: 'ok' });
  sdk.upload_stream.mockImplementation((o: Doc, done: (e?: unknown, r?: unknown) => void) => ({
    end: () =>
      done(undefined, {
        secure_url: `https://res.cloudinary.com/demo/image/upload/v7/${o.public_id}.png`,
        public_id: o.public_id,
        format: 'png',
        width: 300,
        height: 300,
      }),
  }));
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

/* ------------------------------------------------------------------ tests */

describe('recording uploads', () => {
  it('persists the public_id and resource type Cloudinary returned, and the owner', async () => {
    const { assets, uploads } = setup();
    const meta = await uploads.upload(
      { originalname: 'me.png', mimetype: 'image/png', size: png.length, buffer: png },
      UploadPurpose.PROFILE_IMAGE,
      ALICE,
    );
    const [doc] = assets.docs;
    expect(doc).toMatchObject({
      key: meta.key,
      url: meta.url,
      provider: 'cloudinary',
      publicId: meta.publicId,
      resourceType: 'image',
      purpose: 'profileImage',
    });
    expect(String(doc.owner)).toBe(ALICE);
    // The API response is unchanged apart from the optional extras.
    expect(meta.url).toMatch(/^https:\/\//);
  });

  it('records a guest upload without an owner', async () => {
    const { assets, uploads } = setup();
    await uploads.upload(
      { originalname: 'g.png', mimetype: 'image/png', size: png.length, buffer: png },
      UploadPurpose.MEMORY_PHOTO,
    );
    expect(assets.docs[0].owner).toBeNull();
  });
});

describe('replacing an image', () => {
  it('deletes the old file once nothing references it', async () => {
    const { assets, lifecycle } = setup({ users: [{ photoUrl: 'https://new' }] });
    const old = await tracked(assets);
    const [outcome] = await lifecycle.releaseReplaced([old.url], ['https://new'], ALICE);

    expect(outcome.result).toBe('deleted');
    expect(sdk.destroy).toHaveBeenCalledWith(old.publicId, {
      resource_type: 'image',
      invalidate: true,
    });
    expect(old.status).toBe(MediaAssetStatus.DELETED);
  });

  it('keeps a file another record still uses', async () => {
    const { assets, lifecycle, collections } = setup();
    const shared = await tracked(assets);
    collections.organizer_profiles = [{ gallery: [{ url: shared.url, key: shared.key }] }];

    const [outcome] = await lifecycle.releaseReplaced([shared.url], [], ALICE);
    expect(outcome).toMatchObject({
      result: 'kept',
      reason: expect.stringContaining('organizer_profiles'),
    });
    expect(sdk.destroy).not.toHaveBeenCalled();
    expect(shared.status).toBe(MediaAssetStatus.ACTIVE);
  });

  it('keeps a file referenced from free-form site content', async () => {
    const { assets, lifecycle, collections } = setup();
    const asset = await tracked(assets);
    collections.site_content = [{ key: 'home', data: { hero: { image: asset.url } } }];
    const [outcome] = await lifecycle.releaseReplaced([asset.url], [], ALICE);
    expect(outcome.result).toBe('kept');
    expect(sdk.destroy).not.toHaveBeenCalled();
  });

  it('keeps a file it cannot check (a lookup failing counts as "in use")', async () => {
    const { assets, lifecycle } = setup({}, 'packages');
    const asset = await tracked(assets);
    const [outcome] = await lifecycle.releaseReplaced([asset.url], [], ALICE);
    expect(outcome.result).toBe('kept');
    expect(sdk.destroy).not.toHaveBeenCalled();
  });

  it('never deletes a legacy URL-only file, a sample or a default', async () => {
    const { lifecycle } = setup();
    const outcomes = await lifecycle.releaseReplaced(
      [
        '/api/upload/file/profileImage/2025/01/legacy.jpg',
        'https://res.cloudinary.com/demo/sample.jpg',
      ],
      [],
      ALICE,
    );
    expect(outcomes.every((o) => o.result === 'kept')).toBe(true);
    expect(sdk.destroy).not.toHaveBeenCalled();
  });

  it("refuses to delete another user's file, whoever points at it", async () => {
    const { assets, lifecycle } = setup();
    const bobs = await tracked(assets, { owner: BOB });
    // Alice set her photo to Bob's URL, then replaced it.
    const [outcome] = await lifecycle.releaseReplaced([bobs.url], ['https://alice-new'], ALICE);
    expect(outcome).toMatchObject({ result: 'kept', reason: 'not owned by this user' });
    expect(sdk.destroy).not.toHaveBeenCalled();
  });

  it('does nothing when the file is unchanged', async () => {
    const { assets, lifecycle } = setup();
    const same = await tracked(assets);
    expect(await lifecycle.releaseReplaced([same.url], [same.url], ALICE)).toEqual([]);
  });

  it('deletes a video as a video', async () => {
    const { assets, lifecycle } = setup();
    const video = await tracked(assets, { resourceType: 'video', ext: 'mp4' });
    await lifecycle.releaseReplaced([video.url], [], ALICE);
    expect(sdk.destroy).toHaveBeenCalledWith(video.publicId, {
      resource_type: 'video',
      invalidate: true,
    });
  });

  it('backs off when another process has already claimed the file', async () => {
    const { assets, lifecycle } = setup();
    const busy = await tracked(assets);
    busy.status = MediaAssetStatus.DELETING;
    const [outcome] = await lifecycle.releaseReplaced([busy.url], [], ALICE);
    expect(outcome.result).toBe('kept');
    expect(sdk.destroy).not.toHaveBeenCalled();
  });
});

describe('failures and retries', () => {
  it('records a Cloudinary failure, leaves the database alone, and retries later', async () => {
    const { assets, lifecycle } = setup();
    const old = await tracked(assets);
    sdk.destroy.mockRejectedValueOnce({ message: 'Request Timeout', http_code: 499 });

    const [first] = await lifecycle.releaseReplaced([old.url], [], ALICE);
    expect(first.result).toBe('failed');
    expect(old).toMatchObject({
      status: MediaAssetStatus.DELETE_FAILED,
      deleteAttempts: 1,
      lastError: expect.stringContaining('Request Timeout'),
    });

    const [retried] = await lifecycle.retryFailed();
    expect(retried.result).toBe('deleted');
    expect(old.status).toBe(MediaAssetStatus.DELETED);
  });

  it('treats "not found" as done, so a retry after a lost response is not an error', async () => {
    const { assets, lifecycle } = setup();
    const old = await tracked(assets);
    sdk.destroy.mockResolvedValueOnce({ result: 'not found' });
    const [outcome] = await lifecycle.releaseReplaced([old.url], [], ALICE);
    expect(outcome.result).toBe('already_gone');
    expect(old.status).toBe(MediaAssetStatus.DELETED);
  });

  it('is idempotent: releasing the same file twice deletes it once', async () => {
    const { assets, lifecycle } = setup();
    const old = await tracked(assets);
    await lifecycle.releaseReplaced([old.url], [], ALICE);
    const [again] = await lifecycle.releaseReplaced([old.url], [], ALICE);
    expect(again.result).toBe('already_gone');
    expect(sdk.destroy).toHaveBeenCalledTimes(1);
  });

  it('stops retrying after the attempt limit', async () => {
    const { assets, lifecycle } = setup();
    const stuck = await tracked(assets);
    Object.assign(stuck, {
      status: MediaAssetStatus.DELETE_FAILED,
      deleteAttempts: MAX_DELETE_ATTEMPTS,
    });
    expect(await lifecycle.retryFailed()).toEqual([]);
  });

  it('a retry keeps a file that has been put back to use', async () => {
    const { assets, lifecycle, collections } = setup();
    const old = await tracked(assets);
    old.status = MediaAssetStatus.DELETE_FAILED;
    collections.users = [{ photoUrl: old.url }];
    const [outcome] = await lifecycle.retryFailed();
    expect(outcome.result).toBe('kept');
    expect(old.status).toBe(MediaAssetStatus.ACTIVE);
    expect(sdk.destroy).not.toHaveBeenCalled();
  });

  it('refuses an identifier outside the app folder, even from the ledger', async () => {
    const { assets, lifecycle } = setup();
    const odd = await tracked(assets);
    odd.publicId = 'someone-else/private/photo';
    const [outcome] = await lifecycle.releaseReplaced([odd.url], [], ALICE);
    expect(outcome).toMatchObject({
      result: 'failed',
      reason: expect.stringContaining('Refusing'),
    });
    expect(sdk.destroy).not.toHaveBeenCalled();
  });
});

describe('profile photo flow', () => {
  const userService = (
    userModel: Doc,
    lifecycle: Pick<AssetLifecycleService, 'releaseInBackground'>,
  ) =>
    new UserService(
      userModel as never,
      {} as never,
      { get: () => '' } as unknown as ConfigService,
      lifecycle as AssetLifecycleService,
    );

  it('releases the old photo only after the new one is saved', async () => {
    const release = jest.fn();
    const userModel = {
      findById: () => ({ select: () => query({ photoUrl: 'https://old' }) }),
      findByIdAndUpdate: () => query({ photoUrl: 'https://new' }),
    };
    await userService(userModel, { releaseInBackground: release }).updateProfile(ALICE, {
      photoUrl: 'https://new',
    } as never);
    expect(release).toHaveBeenCalledWith(['https://old'], ['https://new'], ALICE);
  });

  it('does not touch the old photo when the database update fails', async () => {
    const release = jest.fn();
    const userModel = {
      findById: () => ({ select: () => query({ photoUrl: 'https://old' }) }),
      findByIdAndUpdate: () => ({ exec: () => Promise.reject(new Error('write conflict')) }),
    };
    await expect(
      userService(userModel, { releaseInBackground: release }).updateProfile(ALICE, {
        photoUrl: 'https://new',
      } as never),
    ).rejects.toThrow('write conflict');
    expect(release).not.toHaveBeenCalled();
  });

  it('leaves photos alone on an edit that does not change the photo', async () => {
    const release = jest.fn();
    const userModel = { findByIdAndUpdate: () => query({ photoUrl: 'https://old' }) };
    await userService(userModel, { releaseInBackground: release }).updateProfile(ALICE, {
      name: 'Alice',
    } as never);
    expect(release).not.toHaveBeenCalled();
  });
});

describe('orphan report and cleanup', () => {
  it('reports candidates and manual-review items without deleting anything', async () => {
    const { assets, lifecycle, collections } = setup();
    const orphan = await tracked(assets);
    const inUse = await tracked(assets);
    const guest = await tracked(assets, { owner: null });
    const fresh = await tracked(assets);
    fresh.createdAt = new Date();
    collections.users = [{ photoUrl: inUse.url }];

    const report = await lifecycle.findOrphans({ minAgeHours: 24, limit: 100 });
    expect(report.candidates.map((c) => c.key)).toEqual([orphan.key]);
    expect(report.candidates[0]).toMatchObject({
      publicId: orphan.publicId,
      resourceType: 'image',
      reason: expect.stringContaining('referenced by no known field'),
    });
    expect(report.manualReview.map((i) => i.key)).toEqual([guest.key]);
    expect(report.inUse).toBe(1);
    expect(sdk.destroy).not.toHaveBeenCalled();
  });

  it('confirmed cleanup re-checks each candidate, and is safe to run twice', async () => {
    const { assets, lifecycle, collections } = setup();
    const a = await tracked(assets);
    const b = await tracked(assets);
    const { candidates } = await lifecycle.findOrphans({ minAgeHours: 24, limit: 100 });
    // b is put back to use between the report and the deletion.
    collections.users = [{ photoUrl: b.url }];

    const first = await lifecycle.deleteOrphans(candidates);
    expect(first.map((o) => o.result)).toEqual(['deleted', 'kept']);
    const second = await lifecycle.deleteOrphans(candidates);
    expect(second.map((o) => o.result)).toEqual(['already_gone', 'kept']);
    expect(sdk.destroy).toHaveBeenCalledTimes(1);
    expect(sdk.destroy).toHaveBeenCalledWith(a.publicId, expect.anything());
  });
});

describe('cleanup guard', () => {
  const dev = {
    NODE_ENV: 'development',
    MONGO_URI: 'mongodb://localhost/evently',
    CLOUDINARY_CLOUD_NAME: 'demo',
  };

  it('defaults to a read-only report', () => {
    const args = parseCleanupArgs([]);
    expect(args).toMatchObject({ delete: false, retryFailed: false, minAgeHours: 24 });
    expect(describeRun(args)).toMatch(/report only/);
    expect(() => assertCleanupAllowed(args, { ...dev, NODE_ENV: 'production' })).not.toThrow();
  });

  it('refuses destructive cleanup in production', () => {
    const args = parseCleanupArgs(['--delete', '--confirm=demo']);
    expect(() => assertCleanupAllowed(args, { ...dev, NODE_ENV: 'production' })).toThrow(
      /production/,
    );
    expect(() =>
      assertCleanupAllowed(args, { ...dev, MONGO_URI: 'mongodb+srv://x@prod-cluster/db' }),
    ).toThrow(/production database/);
    expect(() => assertCleanupAllowed(args, { ...dev, NODE_ENV: undefined })).toThrow(
      /development or test/,
    );
  });

  it('needs the storage name typed out to delete', () => {
    expect(() => assertCleanupAllowed(parseCleanupArgs(['--delete']), dev)).toThrow(
      /--confirm=demo/,
    );
    expect(() =>
      assertCleanupAllowed(parseCleanupArgs(['--delete', '--confirm=demo']), dev),
    ).not.toThrow();
  });

  it('needs --yes to retry, and --allow-production to retry in production', () => {
    expect(() => assertCleanupAllowed(parseCleanupArgs(['--retry-failed']), dev)).toThrow(/--yes/);
    const retry = parseCleanupArgs(['--retry-failed', '--yes']);
    expect(() => assertCleanupAllowed(retry, { ...dev, NODE_ENV: 'production' })).toThrow(
      /--allow-production/,
    );
    expect(() =>
      assertCleanupAllowed(parseCleanupArgs(['--retry-failed', '--yes', '--allow-production']), {
        ...dev,
        NODE_ENV: 'production',
      }),
    ).not.toThrow();
  });

  it('never enforces a minimum age below one hour', () => {
    expect(parseCleanupArgs(['--min-age-hours=0']).minAgeHours).toBe(24);
  });
});

describe('database reset and startup', () => {
  const read = (...p: string[]) => readFileSync(join(__dirname, '..', '..', '..', ...p), 'utf8');

  it('reset:data never calls Cloudinary and keeps the upload ledger', () => {
    const reset = read('scripts', 'reset-data.ts');
    expect(reset).not.toMatch(/from 'cloudinary'|UploadService|AssetLifecycle|destroy\(/);
    expect(reset).toMatch(/'media_assets'/);
  });

  it('seed and app startup never run a cleanup', () => {
    for (const file of [
      read('scripts', 'seed.ts'),
      read('src', 'main.ts'),
      read('src', 'app.module.ts'),
    ]) {
      expect(file).not.toMatch(/findOrphans|deleteOrphans|retryFailed|from 'cloudinary'/);
    }
  });
});

describe('reference fields', () => {
  it('finds a file in nested arrays and in saved invitation versions', async () => {
    const db = referenceDb({
      invitations: [{ publishedContent: { storyCards: [{ imageUrl: 'u1' }] } }],
      bookings: [{ tasks: [{ photoProof: { key: 'k2' } }] }],
    });
    expect(await findReference(db, { url: 'u1', key: '' })).toBe('invitations');
    expect(await findReference(db, { url: '', key: 'k2' })).toBe('bookings');
    expect(await findReference(db, { url: 'nope', key: 'nope' })).toBeNull();
  });
});
