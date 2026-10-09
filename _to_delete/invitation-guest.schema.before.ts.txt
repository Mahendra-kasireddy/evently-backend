import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { idJsonTransform } from '../../../common/utils/id-transform';
import { NotificationKind } from '../invitation-defaults';

export type InvitationGuestDocument = HydratedDocument<InvitationGuest>;

/**
 * Which side of the host's life a guest is from.
 *
 * A fixed three rather than free text: the list exists to be filtered, and
 * free text turns "Friends", "friends" and "College friends" into three
 * groups on the chip row. OTHER is the honest default for a guest imported
 * from a phonebook, where nothing says which they are.
 */
export enum GuestGroup {
  FAMILY = 'family',
  FRIENDS = 'friends',
  WORK = 'work',
  OTHER = 'other',
}

/**
 * What became of one share.
 *
 * `HANDED_OFF` is deliberately not `SENT`. In handoff mode the customer's own
 * WhatsApp is opened with the message ready and the customer presses send —
 * nothing here observes whether they did, whether the number has WhatsApp, or
 * whether it arrived. Recording that as "sent" would be a claim the system
 * cannot support.
 */
export enum ShareStatus {
  /** Opened in the customer's WhatsApp. Delivery unknown by design. */
  HANDED_OFF = 'handed_off',
  /** The provider accepted the message for delivery. */
  SENT = 'sent',
  /** The provider rejected it, or is not configured. */
  FAILED = 'failed',
}

/** One share of one section (or of the whole invitation) to one guest. */
@Schema({ _id: true })
export class GuestShare {
  /** A block key, or '' for the complete invitation. */
  @Prop({ trim: true, default: '' })
  section: string;

  @Prop({ type: String, enum: ShareStatus, required: true })
  status: ShareStatus;

  /** The provider's own id, when there is a provider. */
  @Prop({ trim: true, default: '' })
  providerMessageId: string;

  /** Why it failed, verbatim enough to debug without leaking credentials. */
  @Prop({ trim: true, default: '' })
  error: string;

  @Prop({ type: Date, default: () => new Date() })
  at: Date;
}
export const GuestShareSchema = SchemaFactory.createForClass(GuestShare);

/**
 * Someone the customer shared their published invitation with.
 *
 * A guest is not a user: no account, no password, no login. Identity is the
 * token below, which is the whole point — the spec forbids guest registration,
 * so the link itself has to carry who the guest is.
 *
 * Its own collection rather than an array on the invitation because every
 * guest visit is a lookup *by token*, which against an embedded array would
 * mean scanning invitations. A guest list also grows to hundreds where
 * `subEvents` grows to a handful.
 */
@Schema({
  timestamps: true,
  collection: 'invitation_guests',
  toJSON: idJsonTransform(),
})
/**
 * A notice this guest has been shown and has dismissed.
 *
 * Kept against the guest rather than in a collection of its own: it is a fact
 * about one guest's relationship with one invitation, it is read on every
 * view of that invitation, and it inherits the guest's ownership — so no
 * second authorization rule has to agree with the first.
 *
 * `target` is what the notice was about — the sub-event id the countdown
 * pointed at, or '' for the invitation's own date. Keyed by it on purpose: if
 * the organizer repoints the countdown at a different ceremony, that is a
 * different event, and a guest who dismissed the notice for the old one has
 * not been told about the new one.
 */
@Schema({ _id: false })
export class GuestNotification {
  @Prop({ type: String, enum: NotificationKind, required: true })
  kind: NotificationKind;

  @Prop({ trim: true, default: '' })
  target: string;

  @Prop({ type: Date, required: true })
  dismissedAt: Date;
}
export const GuestNotificationSchema = SchemaFactory.createForClass(GuestNotification);

export class InvitationGuest {
  @Prop({ type: Types.ObjectId, ref: 'Invitation', required: true, index: true })
  invitation: Types.ObjectId;

  /** Denormalised so a token lookup does not need the invitation first. */
  @Prop({ type: Types.ObjectId, ref: 'Booking', required: true, index: true })
  booking: Types.ObjectId;

  @Prop({ required: true, trim: true, maxlength: 80 })
  name: string;

  /** E.164, e.g. `+919505043404` — see `guest/guest-phone.ts`. */
  @Prop({ required: true, trim: true })
  phone: string;

  @Prop({ type: String, enum: GuestGroup, default: GuestGroup.OTHER, index: true })
  group: GuestGroup;

  /**
   * The guest's identity, and their capability to view the invitation.
   *
   * Anyone holding this link can open the invitation — that is inherent to a
   * no-login guest experience, and the reason it is long and random rather
   * than derived from anything guessable like the phone number.
   */
  @Prop({ required: true, unique: true, index: true })
  token: string;

  @Prop({ type: [GuestShareSchema], default: [] })
  shares: GuestShare[];

  /** First time this guest actually opened the invitation. */
  @Prop({ type: Date })
  firstViewedAt?: Date;

  @Prop({ type: Date })
  lastViewedAt?: Date;

  /**
   * Notices this guest has dismissed, so none is ever raised twice.
   *
   * On the record rather than in the browser: the requirement is that a
   * dismissal survives a refresh, a new browser and a different device, and
   * local storage survives none of those.
   */
  @Prop({ type: [GuestNotificationSchema], default: [] })
  notifications: GuestNotification[];

  /**
   * When this guest last said they had the stream open, and which one.
   *
   * What makes the viewer count a count of people actually watching rather
   * than of people who once loaded the page. Stored as a moment and read
   * against a window, so a closed tab stops being counted without anything
   * having to notice that it closed.
   */
  @Prop({ type: Date })
  liveSeenAt?: Date;

  /** The sub-event id the guest was last watching, or '' for none. */
  @Prop({ trim: true, default: '' })
  liveSeenTarget: string;

  createdAt?: Date;
  updatedAt?: Date;
}

export const InvitationGuestSchema = SchemaFactory.createForClass(InvitationGuest);

/**
 * One guest per number per invitation, enforced by the database rather than by
 * a check-then-write in the service — two shares submitted at once would
 * otherwise both find nothing and both insert.
 */
InvitationGuestSchema.index({ invitation: 1, phone: 1 }, { unique: true });
