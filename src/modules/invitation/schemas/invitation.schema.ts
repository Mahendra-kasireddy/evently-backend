import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { idJsonTransform } from '../../../common/utils/id-transform';

export type InvitationDocument = HydratedDocument<Invitation>;

/** Where the invitation sits in the organizer → customer approval loop. */
export enum InvitationStatus {
  /** Organizer is still assembling it; the customer cannot see it. */
  DRAFT = 'draft',
  /** Handed to the customer for review. */
  SENT = 'sent',
  /** Customer signed it off — the guest link is live. */
  APPROVED = 'approved',
}

/** Who fills a section in: the organizer, or the customer on their own screen. */
export enum BlockOwner {
  ORGANIZER = 'organizer',
  CUSTOMER = 'customer',
}

/** One section of the guest invitation — and one row of the builder. */
@Schema({ _id: false })
export class InvitationBlock {
  @Prop({ required: true, trim: true })
  key: string;

  @Prop({ required: true, trim: true })
  title: string;

  /** Icon name resolved to a real glyph by the client. */
  @Prop({ required: true, trim: true })
  icon: string;

  @Prop({ type: String, enum: BlockOwner, required: true })
  owner: BlockOwner;

  @Prop({ default: false })
  hidden: boolean;

  /** Headline shown to guests; blank falls back to `title`. */
  @Prop({ trim: true, default: '' })
  heading: string;

  @Prop({ trim: true, default: '' })
  body: string;
}
export const InvitationBlockSchema = SchemaFactory.createForClass(InvitationBlock);

/** Event-level details every section of the invitation draws from. */
@Schema({ _id: false })
export class InvitationDetails {
  @Prop({ trim: true, default: 'midnight' })
  template: string;

  @Prop({ trim: true, default: '' })
  eyebrow: string;

  @Prop({ trim: true, default: '' })
  hostOne: string;

  @Prop({ trim: true, default: '' })
  hostTwo: string;

  @Prop({ trim: true, default: 'and' })
  joiner: string;

  /** `yyyy-mm-dd` — a wall-clock date, deliberately not a timezone-bearing Date. */
  @Prop({ trim: true, default: '' })
  eventDate: string;

  /** `HH:mm`. */
  @Prop({ trim: true, default: '' })
  eventTime: string;

  @Prop({ trim: true, default: '' })
  venueName: string;

  @Prop({ trim: true, default: '' })
  venueAddress: string;

  @Prop({ trim: true, default: '' })
  message: string;

  @Prop({ default: true })
  rsvpEnabled: boolean;

  /** `yyyy-mm-dd`. */
  @Prop({ trim: true, default: '' })
  rsvpDeadline: string;

  @Prop({ default: true })
  rsvpPlusOnes: boolean;
}
export const InvitationDetailsSchema = SchemaFactory.createForClass(InvitationDetails);

/**
 * A change the customer asked for on a section they do not own.
 *
 * Stored on the invitation rather than sent only as a notification: the
 * organizer has to be able to see the outstanding asks in the builder, so
 * "Request change" reaches someone who can act on it.
 */
@Schema({ _id: true })
export class InvitationChangeRequest {
  /** Empty when the customer asked about the invitation as a whole. */
  @Prop({ trim: true, default: '' })
  blockKey: string;

  /** Section name as it read when the ask was made. */
  @Prop({ trim: true, default: '' })
  blockTitle: string;

  @Prop({ required: true, trim: true, maxlength: 2000 })
  note: string;

  @Prop({ type: Date, default: () => new Date() })
  at: Date;

  @Prop({ default: false })
  resolved: boolean;
}
export const InvitationChangeRequestSchema = SchemaFactory.createForClass(InvitationChangeRequest);

/**
 * The guest invitation an organizer assembles for one booking (P-15). One per
 * booking — the organizer owns the logistics sections, the customer owns the
 * personal ones and gives the final sign-off that makes the guest link live.
 */
@Schema({
  timestamps: true,
  collection: 'invitations',
  toJSON: idJsonTransform(),
})
export class Invitation {
  @Prop({ type: Types.ObjectId, ref: 'Booking', required: true, unique: true, index: true })
  booking: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'OrganizerProfile', required: true, index: true })
  organizer: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  customer: Types.ObjectId;

  @Prop({ type: InvitationDetailsSchema, default: () => ({}) })
  details: InvitationDetails;

  @Prop({ type: [InvitationBlockSchema], default: [] })
  blocks: InvitationBlock[];

  @Prop({ type: [InvitationChangeRequestSchema], default: [] })
  changeRequests: InvitationChangeRequest[];

  @Prop({ type: String, enum: InvitationStatus, default: InvitationStatus.DRAFT, index: true })
  status: InvitationStatus;

  @Prop({ type: Date })
  sentAt?: Date;

  @Prop({ type: Date })
  approvedAt?: Date;

  createdAt?: Date;
  updatedAt?: Date;
}

export const InvitationSchema = SchemaFactory.createForClass(Invitation);
