import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';

import { findReference, ReferenceDb } from './asset-references';
import { MediaAsset, MediaAssetDocument, MediaAssetStatus } from './schemas/media-asset.schema';
import { errorText, UploadService } from './upload.service';

/** What happened to one file a flow let go of. */
export type ReleaseOutcome =
  | { url: string; result: 'deleted' | 'already_gone' }
  | { url: string; result: 'kept'; reason: string }
  | { url: string; result: 'failed'; reason: string };

/** A file the orphan report thinks is safe to delete, and why. */
export interface OrphanCandidate {
  id: string;
  key: string;
  publicId: string;
  resourceType: string;
  provider: string;
  owner: string;
  reason: string;
}

/** A file the report will not decide about: a person should look at it. */
export interface ReviewItem {
  key: string;
  publicId: string;
  resourceType: string;
  reason: string;
}

export interface OrphanReport {
  candidates: OrphanCandidate[];
  manualReview: ReviewItem[];
  pendingRetry: ReviewItem[];
  inUse: number;
  scanned: number;
}

/** After this many failed attempts a deletion is left for a person to look at. */
export const MAX_DELETE_ATTEMPTS = 5;

/** A claim older than this is treated as abandoned (a crash mid-delete). */
const STALE_CLAIM_MS = 15 * 60 * 1000;

/**
 * Deletes files that a flow has stopped using — and only those.
 *
 * Called *after* the database change that dropped the reference has been
 * saved, so a failed save can never cost a file. For each file it confirms,
 * in order, that:
 *
 *  1. it is a tracked upload (a `media_assets` record with the provider's own
 *     id) — legacy URL-only files, samples and defaults are kept;
 *  2. it was uploaded by the user whose record is changing — nobody can cause
 *     the deletion of someone else's file by pointing their profile at it;
 *  3. nothing else references it (see asset-references) — shared files stay;
 *  4. no other process is deleting it (an atomic status claim), and it is
 *     still unreferenced once claimed.
 *
 * Only then is the provider asked to delete it. A provider failure leaves the
 * database as it is and marks the file `delete_failed`, which `retryFailed`
 * (and the cleanup script) picks up. Nothing here throws to the caller: the
 * user's change has already succeeded and must be reported as such.
 */
@Injectable()
export class AssetLifecycleService {
  private readonly logger = new Logger(AssetLifecycleService.name);

  constructor(
    @InjectModel(MediaAsset.name) private readonly assets: Model<MediaAsset>,
    @InjectConnection() private readonly connection: Connection,
    private readonly uploads: UploadService,
  ) {}

  /**
   * Lets go of the files in `before` that are not in `after`, on behalf of
   * `ownerId`. Use from a flow that has just saved a replacement or removal.
   */
  async releaseReplaced(
    before: Array<string | null | undefined>,
    after: Array<string | null | undefined>,
    ownerId: string,
  ): Promise<ReleaseOutcome[]> {
    const kept = new Set(after.filter(Boolean));
    const dropped = [...new Set(before.filter((u): u is string => !!u && !kept.has(u)))];
    const outcomes: ReleaseOutcome[] = [];
    for (const url of dropped) {
      outcomes.push(await this.releaseOne(url, ownerId));
    }
    return outcomes;
  }

  /** The same, without waiting: for request handlers that should not slow down. */
  releaseInBackground(
    before: Array<string | null | undefined>,
    after: Array<string | null | undefined>,
    ownerId: string,
  ): void {
    void this.releaseReplaced(before, after, ownerId).catch((err) =>
      this.logger.error(`Asset release failed: ${errorText(err)}`),
    );
  }

  /** Retries deletions that failed, or were abandoned mid-way. Idempotent. */
  async retryFailed(limit = 50): Promise<ReleaseOutcome[]> {
    const stale = new Date(Date.now() - STALE_CLAIM_MS);
    const due = await this.assets
      .find({
        $or: [
          { status: MediaAssetStatus.DELETE_FAILED },
          { status: MediaAssetStatus.DELETING, lastAttemptAt: { $lt: stale } },
        ],
        deleteAttempts: { $lt: MAX_DELETE_ATTEMPTS },
      })
      .limit(limit)
      .exec();
    const outcomes: ReleaseOutcome[] = [];
    for (const asset of due) {
      // The owner check passed when the deletion was first decided.
      outcomes.push(await this.deleteIfUnused(asset, { retry: true }));
    }
    return outcomes;
  }

  /**
   * Read-only: which tracked files look unused. A file is a *candidate* only
   * if it is tracked with the provider's own id, has an owner, is older than
   * `minAgeHours` (so a file uploaded a moment ago, not yet saved onto its
   * record, is never caught) and nothing references it. Everything it cannot
   * decide about goes to `manualReview` instead.
   */
  async findOrphans({
    minAgeHours,
    limit,
  }: {
    minAgeHours: number;
    limit: number;
  }): Promise<OrphanReport> {
    const db = this.connection.db as unknown as ReferenceDb;
    const cutoff = new Date(Date.now() - Math.max(1, minAgeHours) * 3600_000);
    const report: OrphanReport = {
      candidates: [],
      manualReview: [],
      pendingRetry: [],
      inUse: 0,
      scanned: 0,
    };

    const active = await this.assets
      .find({ status: MediaAssetStatus.ACTIVE, createdAt: { $lt: cutoff } })
      .sort({ createdAt: 1 })
      .limit(limit)
      .exec();
    for (const asset of active) {
      report.scanned += 1;
      const base = {
        key: asset.key,
        publicId: asset.publicId,
        resourceType: asset.resourceType,
      };
      if (asset.provider === 'cloudinary' && !asset.publicId) {
        report.manualReview.push({ ...base, reason: 'no Cloudinary public_id recorded' });
        continue;
      }
      if (!asset.owner) {
        report.manualReview.push({
          ...base,
          reason: 'no owner (guest upload or rendition) — managed by its own feature',
        });
        continue;
      }
      const ref = await findReference(db, asset);
      if (ref) {
        report.inUse += 1;
        continue;
      }
      report.candidates.push({
        id: asset._id.toString(),
        ...base,
        provider: asset.provider,
        owner: asset.owner.toString(),
        reason: `tracked upload by ${asset.owner.toString()}, older than ${minAgeHours}h, referenced by no known field`,
      });
    }

    const failed = await this.assets
      .find({ status: { $in: [MediaAssetStatus.DELETE_FAILED, MediaAssetStatus.DELETING] } })
      .limit(limit)
      .exec();
    for (const asset of failed) {
      report.pendingRetry.push({
        key: asset.key,
        publicId: asset.publicId,
        resourceType: asset.resourceType,
        reason: `${asset.status} after ${asset.deleteAttempts} attempt(s): ${asset.lastError || '—'}`,
      });
    }
    return report;
  }

  /**
   * Deletes the given candidates — each re-loaded and re-checked first, so a
   * report that went stale (a file put back to use) deletes nothing it
   * should not. Safe to run twice.
   */
  async deleteOrphans(candidates: OrphanCandidate[]): Promise<ReleaseOutcome[]> {
    const outcomes: ReleaseOutcome[] = [];
    for (const c of candidates) {
      if (!Types.ObjectId.isValid(c.id)) continue;
      const asset = await this.assets.findById(c.id).exec();
      if (!asset) continue;
      if (asset.status === MediaAssetStatus.DELETED) {
        outcomes.push({ url: asset.url, result: 'already_gone' });
        continue;
      }
      if (asset.status !== MediaAssetStatus.ACTIVE || !asset.owner) {
        outcomes.push({ url: asset.url, result: 'kept', reason: `status ${asset.status}` });
        continue;
      }
      outcomes.push(await this.deleteIfUnused(asset, { retry: false }));
    }
    return outcomes;
  }

  /* ------------------------------------------------------------------ */

  private async releaseOne(url: string, ownerId: string): Promise<ReleaseOutcome> {
    const asset = await this.assets.findOne({ url }).exec();
    if (!asset) {
      // A legacy URL-only file, a sample, a default, an external URL: there is
      // no reliable public_id for it, so it is never deleted automatically.
      this.logger.log(`Kept untracked file ${shortUrl(url)}`);
      return { url, result: 'kept', reason: 'untracked (legacy, sample or external)' };
    }
    if (asset.status === MediaAssetStatus.DELETED) return { url, result: 'already_gone' };
    if (!asset.owner || !Types.ObjectId.isValid(ownerId) || !asset.owner.equals(ownerId)) {
      this.logger.log(`Kept ${asset.key}: not uploaded by the user releasing it`);
      return { url, result: 'kept', reason: 'not owned by this user' };
    }
    return this.deleteIfUnused(asset, { retry: false });
  }

  private async deleteIfUnused(
    asset: MediaAssetDocument,
    { retry }: { retry: boolean },
  ): Promise<ReleaseOutcome> {
    const url = asset.url;
    const db = this.connection.db as unknown as ReferenceDb;

    const before = await findReference(db, asset);
    if (before) {
      if (retry) await this.setStatus(asset._id, MediaAssetStatus.ACTIVE);
      this.logger.log(`Kept ${asset.key}: still referenced by ${before}`);
      return { url, result: 'kept', reason: `still referenced by ${before}` };
    }

    // Claim it, so two concurrent releases cannot both act on it.
    const claimable = retry
      ? [MediaAssetStatus.DELETE_FAILED, MediaAssetStatus.DELETING]
      : [MediaAssetStatus.ACTIVE, MediaAssetStatus.DELETE_FAILED];
    const claimed = await this.assets
      .findOneAndUpdate(
        { _id: asset._id, status: { $in: claimable } },
        { status: MediaAssetStatus.DELETING, lastAttemptAt: new Date() },
        { new: true },
      )
      .exec();
    if (!claimed) return { url, result: 'kept', reason: 'being handled elsewhere' };

    // Re-check after the claim: a save that landed in between wins.
    const after = await findReference(db, asset);
    if (after) {
      await this.setStatus(asset._id, MediaAssetStatus.ACTIVE);
      return { url, result: 'kept', reason: `still referenced by ${after}` };
    }

    try {
      const outcome = await this.uploads.deleteStored({
        key: asset.key,
        publicId: asset.publicId,
        resourceType: asset.resourceType,
      });
      await this.assets
        .updateOne(
          { _id: asset._id },
          { status: MediaAssetStatus.DELETED, deletedAt: new Date(), lastError: '' },
        )
        .exec();
      this.logger.log(`Deleted ${asset.key} (${outcome})`);
      return { url, result: outcome === 'deleted' ? 'deleted' : 'already_gone' };
    } catch (err) {
      const reason = errorText(err);
      await this.assets
        .updateOne(
          { _id: asset._id },
          {
            status: MediaAssetStatus.DELETE_FAILED,
            lastError: reason,
            lastAttemptAt: new Date(),
            $inc: { deleteAttempts: 1 },
          },
        )
        .exec();
      this.logger.warn(`Could not delete ${asset.key}; will retry: ${reason}`);
      return { url, result: 'failed', reason };
    }
  }

  private async setStatus(id: Types.ObjectId, status: MediaAssetStatus): Promise<void> {
    await this.assets.updateOne({ _id: id }, { status }).exec();
  }
}

/** A URL short enough for a log line, without query strings. */
function shortUrl(url: string): string {
  const clean = url.split('?')[0];
  return clean.length > 80 ? `…${clean.slice(-77)}` : clean;
}
