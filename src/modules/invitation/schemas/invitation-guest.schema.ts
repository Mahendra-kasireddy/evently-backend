import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { idJsonTransform } from '../../../common/utils/id-transform';

export type InvitationGuestDocument = HydratedDocument<InvitationGuest>;

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
