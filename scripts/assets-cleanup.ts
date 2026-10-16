/**
 * Finds stored files nothing uses any more — and, only when asked in so many
 * words, deletes them.
 *
 * Usage:
 *   npm run assets:cleanup                         # report only (the default)
 *   npm run assets:cleanup -- --scan-cloudinary    # + list Cloudinary files we have no record of
 *   npm run assets:cleanup -- --delete --confirm=<cloud name>   # dev/test only
 *   npm run assets:cleanup -- --retry-failed --yes # finish deletions that failed earlier
 *
 * Options: --min-age-hours=24 (files younger than this are never touched),
 *          --limit=500 (records examined per run).
 *
 * What can be deleted: only files recorded in `media_assets` when they were
 * uploaded (so their Cloudinary public_id is known, not guessed), with an
 * owner, older than --min-age-hours, that no known field references — each
 * re-checked immediately before deletion. Everything else (legacy URL-only
 * files, samples, defaults, guest uploads, files Cloudinary has that we have
 * no record of) is listed for manual review and never deleted.
 *
 * Never run automatically: not on startup, deploy, seed or reset. The rules
 * on where each mode may run live in src/modules/upload/asset-cleanup.guard.ts.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { v2 as cloudinary } from 'cloudinary';
import type { ConfigService } from '@nestjs/config';

import configuration from '../src/config/configuration';
import { MediaAsset, MediaAssetSchema } from '../src/modules/upload/schemas/media-asset.schema';
import { UploadService } from '../src/modules/upload/upload.service';
import {
  AssetLifecycleService,
  ReleaseOutcome,
  ReviewItem,
} from '../src/modules/upload/asset-lifecycle.service';
import {
  assertCleanupAllowed,
  describeRun,
  parseCleanupArgs,
} from '../src/modules/upload/asset-cleanup.guard';

const SCAN_PAGE_SIZE = 100;
const SCAN_MAX_PAGES = 20;
const SCAN_PAUSE_MS = 600;

function redactedUri(uri: string): string {
  return uri.replace(/\/\/([^:]+):[^@]+@/, '//$1:***@');
}

/** A ConfigService stand-in over the app's own configuration factory. */
function configFrom(values: Record<string, unknown>): ConfigService {
  const get = (path: string, fallback?: unknown) => {
    const found = path
      .split('.')
      .reduce<unknown>(
        (node, part) =>
          node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined,
        values,
      );
    return found === undefined ? fallback : found;
  };
  return { get } as unknown as ConfigService;
}

function printItems(title: string, items: ReviewItem[]): void {
  console.log(`\n${title}: ${items.length}`);
  for (const i of items.slice(0, 50)) {
    console.log(`  - [${i.resourceType || '?'}] ${i.publicId || i.key}  — ${i.reason}`);
  }
  if (items.length > 50) console.log(`  … and ${items.length - 50} more`);
}

function printOutcomes(outcomes: ReleaseOutcome[]): void {
  const by = (r: string) => outcomes.filter((o) => o.result === r).length;
  console.log(
    `\ndeleted ${by('deleted')}, already gone ${by('already_gone')}, kept ${by('kept')}, failed ${by('failed')}`,
  );
  for (const o of outcomes) {
    if (o.result === 'kept' || o.result === 'failed')
      console.log(`  ${o.result}: ${o.url} — ${o.reason}`);
  }
}

/**
 * Read-only listing of the app's Cloudinary folder, to find files we hold no
 * record of. Paged and paced; reports, never deletes.
 */
async function scanUntracked(folder: string, known: Set<string>): Promise<ReviewItem[]> {
  const untracked: ReviewItem[] = [];
  for (const resourceType of ['image', 'video', 'raw'] as const) {
    let cursor: string | undefined;
    for (let page = 0; page < SCAN_MAX_PAGES; page += 1) {
      const res = (await cloudinary.api.resources({
        type: 'upload',
        resource_type: resourceType,
        prefix: `${folder}/`,
        max_results: SCAN_PAGE_SIZE,
        next_cursor: cursor,
      })) as { resources?: Array<{ public_id: string }>; next_cursor?: string };
      for (const r of res.resources ?? []) {
        if (!known.has(r.public_id)) {
          untracked.push({
            key: '',
            publicId: r.public_id,
            resourceType,
            reason:
              'in Cloudinary but not in media_assets (legacy or outside the app) — not deleted',
          });
        }
      }
      cursor = res.next_cursor;
      if (!cursor) break;
      await new Promise((r) => setTimeout(r, SCAN_PAUSE_MS));
    }
  }
  return untracked;
}

async function main(): Promise<void> {
  const args = parseCleanupArgs(process.argv.slice(2));
  try {
    assertCleanupAllowed(args, process.env);
  } catch (err) {
    console.error(`Refusing to run: ${(err as Error).message}`);
    process.exit(1);
  }

  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('MONGO_URI is not set. Add it to .env first.');
    process.exit(1);
  }
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });

  const values = configuration() as unknown as Record<string, unknown>;
  const upload = values.upload as { driver: string; cloudinary: { folder: string } };
  const model =
    mongoose.models[MediaAsset.name] ?? mongoose.model(MediaAsset.name, MediaAssetSchema);
  const uploads = new UploadService(configFrom(values), model);
  uploads.onModuleInit();
  const lifecycle = new AssetLifecycleService(model, mongoose.connection, uploads);

  console.log(`\ndatabase : ${mongoose.connection.db?.databaseName}`);
  console.log(`uri      : ${redactedUri(uri)}`);
  console.log(`storage  : ${upload.driver}`);
  console.log(`mode     : ${describeRun(args)}`);

  if (args.retryFailed) {
    printOutcomes(await lifecycle.retryFailed(args.limit));
    await mongoose.disconnect();
    return;
  }

  const report = await lifecycle.findOrphans({ minAgeHours: args.minAgeHours, limit: args.limit });
  console.log(
    `\nexamined ${report.scanned} tracked file(s) older than ${args.minAgeHours}h; ${report.inUse} in use`,
  );
  console.log(`\norphan candidates: ${report.candidates.length}`);
  for (const c of report.candidates.slice(0, 100)) {
    console.log(`  - [${c.resourceType}] ${c.publicId || c.key}  — ${c.reason}`);
  }
  printItems('manual review (never auto-deleted)', report.manualReview);
  printItems('failed deletions waiting for --retry-failed', report.pendingRetry);

  if (args.scanCloudinary) {
    if (upload.driver !== 'cloudinary') {
      console.log('\n--scan-cloudinary skipped: UPLOAD_DRIVER is not cloudinary.');
    } else {
      const known = new Set(
        (await model.find({}, { publicId: 1 }).lean().exec())
          .map((a) => a.publicId)
          .filter(Boolean),
      );
      printItems(
        'Cloudinary files with no record',
        await scanUntracked(upload.cloudinary.folder, known),
      );
    }
  }

  if (args.delete) {
    printOutcomes(await lifecycle.deleteOrphans(report.candidates));
  } else {
    console.log('\nReport only — nothing was deleted.');
  }
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('assets:cleanup failed:', (err as Error)?.message ?? err);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
