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

/**
 * Who a Save-the-Date card is shown to.
 *
 * Only two values, deliberately. Targeting a card at named invitees needs an
 * invitee to point at, and the platform has no guest record of any kind yet —
 * no guest list, no share link, no guest identity. Adding a `SPECIFIC` value
 * now would be a state nothing can ever set or honour, so it waits for the
 * guest surface that gives it meaning.
 */
export enum SubEventVisibility {
  /** Every guest who opens the invitation sees this card. */
  ALL_GUESTS = 'all',
  /** Kept in the builder but not rendered to guests. */
  HIDDEN = 'hidden',
}

/**
 * One sub-event of the celebration — a mehendi, the ceremony, a reception —
 * and one Save-the-Date card.
 *
 * Sub-events live on the invitation rather than in their own collection: they
 * exist only as part of the invitation an organizer assembles for one booking,
 * are always read and written with it, and are bounded in number. That is the
 * same reasoning as `blocks`, and it keeps the guest view a single document
 * read.
 *
 * Note this is unrelated to the `plan-event` `Event` collection, which models a
 * ticketed listing with capacity and a price. Reusing that here would have
 * dragged in a payment and publishing lifecycle the invitation has no use for.
 */
@Schema({ _id: true })
export class InvitationSubEvent {
  @Prop({ required: true, trim: true, maxlength: 80 })
  name: string;

  /** `yyyy-mm-dd` — a wall-clock date, read against `timezone` below. */
  @Prop({ trim: true, default: '' })
  eventDate: string;

  /** `HH:mm`. */
  @Prop({ trim: true, default: '' })
  eventTime: string;

  /**
   * `HH:mm`, optional.
   *
   * Not asked for on the card, but a calendar entry has to end somewhere: an
   * organizer who leaves this blank gets the default duration rather than an
   * entry that runs to midnight or is rejected outright by the calendar app.
   */
  @Prop({ trim: true, default: '' })
  endTime: string;

  /** IANA zone the two wall-clock fields above are expressed in. */
  @Prop({ trim: true, default: 'Asia/Kolkata' })
  timezone: string;

  @Prop({ trim: true, default: '', maxlength: 120 })
  venueName: string;

  @Prop({ trim: true, default: '', maxlength: 240 })
  venueAddress: string;

  @Prop({ trim: true, default: '', maxlength: 80 })
  dressCode: string;

  @Prop({ trim: true, default: '', maxlength: 300 })
  note: string;

  /**
   * Card colour, as a palette id from `CARD_PALETTE` — an id and not a raw hex
   * value, so a card can never be styled into illegibility and the palette can
   * be restyled centrally. Empty means "follow the invitation template".
   */
  @Prop({ trim: true, default: '' })
  colour: string;

  @Prop({ type: String, enum: SubEventVisibility, default: SubEventVisibility.ALL_GUESTS })
  visibility: SubEventVisibility;
}
export const InvitationSubEventSchema = SchemaFactory.createForClass(InvitationSubEvent);

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

  /**
   * IANA zone the wall-clock eventDate/eventTime above are expressed in.
   *
   * Those two fields carry no zone of their own, which is fine for printing a
   * date but not for a live countdown: a guest opening the invitation from
   * another country must still see the correct time remaining. Resolving the
   * pair against this zone is what makes that true.
   *
   * Defaults to Asia/Kolkata because every city in the platform's own
   * configuration is Indian; an organizer running an event elsewhere changes
   * it in the builder.
   */
  @Prop({ trim: true, default: 'Asia/Kolkata' })
  timezone: string;

  /**
   * Shown in place of the countdown once the event's start time has passed.
   * Empty means the countdown simply stops at zero rather than inventing a
   * message the organizer never wrote.
   */
  @Prop({ trim: true, default: '', maxlength: 400 })
  postEventMessage: string;

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

  /**
   * The Save-the-Date cards, in the order the organizer arranged them. Array
   * order is the display order, so reordering is a write of the whole list —
   * no separate sort key to drift out of step with it.
   */
  @Prop({ type: [InvitationSubEventSchema], default: [] })
  subEvents: InvitationSubEvent[];

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
