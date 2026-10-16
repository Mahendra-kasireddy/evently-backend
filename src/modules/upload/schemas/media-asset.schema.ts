import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export enum MediaAssetStatus {
  /** Stored, and as far as we know in use (or about to be). */
  ACTIVE = 'active',
  /** A deletion has claimed it; set back to ACTIVE or moved on within one call. */
  DELETING = 'deleting',
  DELETED = 'deleted',
  /** A deletion was decided but the provider call failed — retryable. */
  DELETE_FAILED = 'delete_failed',
}

/**
 * One stored file, as the storage provider reported it at upload time.
 *
 * This is what makes a deletion safe: the provider's own `publicId` and
 * `resourceType` are recorded here (never re-derived from a URL), and so is
 * who uploaded it. A file with no record here — anything uploaded before this
 * collection existed, a seeded sample, a default image — is never deleted
 * automatically; it can only be reported for manual review.
 *
 * Deliberately not cleared by `npm run reset:data`: losing these records would
 * turn every stored file into an untracked one, which is the safe direction,
 * but would also forget failed deletions that still need a retry.
 */
@Schema({ collection: 'media_assets', timestamps: true })
export class MediaAsset {
  /** Evently's storage key (`<purpose>/<yyyy>/<mm>/<uuid>.<ext>`). */
  @Prop({ required: true, unique: true, trim: true })
  key: string;

  @Prop({ required: true, trim: true, index: true })
  url: string;

  @Prop({ required: true, enum: ['cloudinary', 'local'] })
  provider: 'cloudinary' | 'local';

  /** Cloudinary's `public_id`, exactly as returned by the upload. */
  @Prop({ trim: true, default: '' })
  publicId: string;

  @Prop({ enum: ['image', 'video', 'raw', ''], default: '' })
  resourceType: 'image' | 'video' | 'raw' | '';

  /** The upload purpose, or `variant` for a server-made rendition. */
  @Prop({ trim: true, default: '' })
  purpose: string;

  /** Who uploaded it. Null for guest uploads and server-made variants. */
  @Prop({ type: Types.ObjectId, ref: 'User', default: null, index: true })
  owner: Types.ObjectId | null;

  @Prop({
    enum: Object.values(MediaAssetStatus),
    default: MediaAssetStatus.ACTIVE,
    index: true,
  })
  status: MediaAssetStatus;

  @Prop({ default: 0 })
  deleteAttempts: number;

  /** The provider's message from the last failed deletion — never credentials. */
  @Prop({ default: '' })
  lastError: string;

  @Prop({ type: Date, default: null })
  lastAttemptAt: Date | null;

  @Prop({ type: Date, default: null })
  deletedAt: Date | null;

  createdAt?: Date;
  updatedAt?: Date;
}

export type MediaAssetDocument = HydratedDocument<MediaAsset>;
export const MediaAssetSchema = SchemaFactory.createForClass(MediaAsset);
