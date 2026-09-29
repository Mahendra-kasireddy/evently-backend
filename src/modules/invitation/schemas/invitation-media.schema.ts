import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { idJsonTransform } from '../../../common/utils/id-transform';
import { MediaFlag, MediaKind, MediaState } from '../memories/memory.constants';

export type InvitationMediaDocument = HydratedDocument<InvitationMedia>;

/** Where a piece of media stands with the person who owns the invitation. */
export enum ModerationStatus {
  /** Nobody has looked, and nobody needs to: moderation is off. */
  NOT_REQUIRED = 'notRequired',
  AWAITING = 'awaiting',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

/** Who a piece of media is shown to. */
export enum MediaVisibility {
  /** Everyone who can see the invitation. */
  GALLERY = 'gallery',
  /**
   * The guest who uploaded it, and nobody else.
   *
   * Where a duplicate or a photograph the checks flagged goes. Not deleted,
   * because the person who took it should be able to see what happened to it
   * and say they meant it.
   */
  UPLOADER = 'uploader',
}

/**
 * Whether the smaller copies of a photograph were made.
 *
 * Recorded rather than inferred from an empty key, because "never tried" and
 * "tried and failed" need different answers: the first is a clip or an old
 * record, the second is something to look into. Either way the original is
 * untouched and the gallery falls back to it, so a failure is slower, never
 * broken.
 */
export enum RenditionStatus {
  /** No smaller copies: a clip, or a photograph uploaded before this existed. */
  NONE = 'none',
  READY = 'ready',
  FAILED = 'failed',
}

/** What the checks said about a photograph. */
export enum QualityStatus {
  OK = 'ok',
  FLAGGED = 'flagged',
  /** A clip: the checks read pixels, and no frame was decoded. */
  NOT_CHECKED = 'notChecked',
}

/**
 * One photograph, video or reel a guest added to an invitation.
 *
 * Its own collection rather than an array on the invitation, for the reason
 * the guest list is: a gallery grows to thousands where `subEvents` grows to a
 * handful, every read of it is a filtered, paginated query, and an unbounded
 * array inside one document is a document that eventually stops saving.
 *
 * No bytes live here. The file is in the storage driver every other upload in
 * the platform uses, and this holds the handle to it.
 */
@Schema({
  timestamps: true,
  collection: 'invitation_media',
  toJSON: idJsonTransform(),
})
export class InvitationMedia {
  /** The invitation this belongs to. Every query is scoped by it. */
  @Prop({ type: Types.ObjectId, ref: 'Invitation', required: true, index: true })
  invitation: Types.ObjectId;

  /** Denormalised, so ownership can be checked without a second read. */
  @Prop({ type: Types.ObjectId, ref: 'Booking', required: true, index: true })
  booking: Types.ObjectId;

  /**
   * The sub-event this was sorted into, or '' for the celebration itself.
   *
   * A string rather than a reference: sub-events are subdocuments of the
   * invitation, so there is no collection to populate from, and the id is only
   * ever compared.
   */
  @Prop({ trim: true, default: '', index: true })
  subEvent: string;

  /**
   * Which guest uploaded it, when a guest did.
   *
   * Absent on a memory the customer added from their own phone: they are not
   * on their own guest list, and inventing a guest record for them would put
   * the host into every group filter and every share. `host` below says which
   * kind this is, rather than the absence of a reference having to mean it.
   */
  @Prop({ type: Types.ObjectId, ref: 'InvitationGuest', index: true })
  guest?: Types.ObjectId;

  /** True when the customer added this themselves. */
  @Prop({ type: Boolean, default: false })
  host: boolean;

  /** True when the organizer running the celebration added it. */
  @Prop({ type: Boolean, default: false })
  organizer: boolean;

  @Prop({ type: String, enum: MediaKind, required: true, index: true })
  kind: MediaKind;

  /** Storage handle, for serving and for deletion. Never sent to a guest. */
  @Prop({ required: true, trim: true })
  storageKey: string;

  @Prop({ required: true, trim: true })
  url: string;

  /** A smaller rendition for the grid, when one could be made. */
  @Prop({ trim: true, default: '' })
  thumbnailKey: string;

  @Prop({ trim: true, default: '' })
  thumbnailUrl: string;

  /** The full-screen rendition. The original is kept for downloads only. */
  @Prop({ trim: true, default: '' })
  displayKey: string;

  @Prop({ trim: true, default: '' })
  displayUrl: string;

  @Prop({ type: String, enum: RenditionStatus, default: RenditionStatus.NONE })
  renditionStatus: RenditionStatus;

  @Prop({ trim: true, default: '', maxlength: 200 })
  caption: string;

  @Prop({ type: String, enum: MediaState, default: MediaState.PUBLISHED, index: true })
  status: MediaState;

  @Prop({ type: String, enum: ModerationStatus, default: ModerationStatus.NOT_REQUIRED })
  moderationStatus: ModerationStatus;

  @Prop({ type: String, enum: MediaVisibility, default: MediaVisibility.GALLERY })
  visibility: MediaVisibility;

  /**
   * SHA-256 of the bytes. Catches the same file uploaded twice exactly, which
   * is most of what a shared gallery collects, and costs nothing.
   */
  @Prop({ trim: true, default: '', index: true })
  byteHash: string;

  /**
   * 64-bit difference hash, as hex. Photographs only — it is computed from
   * pixels, and no frame is decoded from a clip.
   */
  @Prop({ trim: true, default: '', index: true })
  perceptualHash: string;

  @Prop({ type: String, enum: QualityStatus, default: QualityStatus.NOT_CHECKED })
  qualityStatus: QualityStatus;

  @Prop({ type: [String], enum: MediaFlag, default: [] })
  qualityFlags: MediaFlag[];

  /** Seconds, for a clip. Zero for a photograph. */
  @Prop({ type: Number, default: 0, min: 0 })
  durationSec: number;

  /**
   * The guests who liked this.
   *
   * Ids on the record rather than a collection of their own: a like is one
   * guest's relationship with one item, it is read on every render of the
   * gallery, and holding it here makes "one like per guest" a property of the
   * data instead of a rule someone has to remember. Bounded by the guest list,
   * which is hundreds, not the gallery, which is thousands.
   */
  @Prop({ type: [Types.ObjectId], ref: 'InvitationGuest', default: [] })
  likes: Types.ObjectId[];

  createdAt?: Date;
  updatedAt?: Date;
}

export const InvitationMediaSchema = SchemaFactory.createForClass(InvitationMedia);

/*
 * The gallery's own query: one invitation, newest first, optionally narrowed
 * by tab and by celebration. Compound and ordered the way the query reads it,
 * so the sort is served by the index rather than done in memory.
 */
InvitationMediaSchema.index({ invitation: 1, status: 1, createdAt: -1 });
InvitationMediaSchema.index({ invitation: 1, kind: 1, status: 1, createdAt: -1 });
InvitationMediaSchema.index({ invitation: 1, subEvent: 1, status: 1, createdAt: -1 });
/* Duplicate lookups, both scoped to the invitation: a photograph is only a
   duplicate of another photograph at the same wedding. */
InvitationMediaSchema.index({ invitation: 1, byteHash: 1 });
InvitationMediaSchema.index({ invitation: 1, perceptualHash: 1 });
/* One guest's own uploads, for their count and for what they may still see. */
InvitationMediaSchema.index({ invitation: 1, guest: 1, createdAt: -1 });
