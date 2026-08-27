import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { idJsonTransform } from '../../../common/utils/id-transform';
import { HydratedDocument, Types } from 'mongoose';

export type ContactRequestDocument = HydratedDocument<ContactRequest>;

/** Where a support request is in the team's queue. */
export enum ContactStatus {
  NEW = 'new',
  IN_PROGRESS = 'in_progress',
  RESPONDED = 'responded',
  CLOSED = 'closed',
}

/**
 * What the request is about — the routing signal for the support team.
 * Stored as a key so the admin console can filter on it; the customer picks
 * from the matching labels.
 */
export enum ContactSubject {
  GENERAL = 'general',
  EVENT_PLANNING = 'event_planning',
  ORGANIZER = 'organizer',
  BOOKING = 'booking',
  BILLING = 'billing',
  TECHNICAL = 'technical',
  OTHER = 'other',
}

@Schema({
  timestamps: true,
  collection: 'contact_requests',
  toJSON: idJsonTransform(),
})
export class ContactRequest {
  /**
   * The signed-in customer who sent this, when there was one.
   *
   * Null for a guest — contacting support must never require an account, so
   * this is deliberately optional. It is always derived from the access token
   * on the server; a `userId` in the request body is ignored.
   */
  @Prop({ type: Types.ObjectId, ref: 'User', default: null, index: true })
  user: Types.ObjectId | null;

  @Prop({ required: true, trim: true, maxlength: 80 })
  name: string;

  @Prop({ required: true, trim: true, lowercase: true, maxlength: 160, index: true })
  email: string;

  /** 10-digit Indian mobile, matching the convention used by OTP login. */
  @Prop({ required: true, trim: true, maxlength: 15 })
  phone: string;

  @Prop({ type: String, enum: ContactSubject, required: true, index: true })
  subject: ContactSubject;

  @Prop({ required: true, trim: true, maxlength: 5000 })
  message: string;

  @Prop({ type: String, enum: ContactStatus, default: ContactStatus.NEW, index: true })
  status: ContactStatus;

  // ---- Support team's reply ----

  @Prop({ trim: true, default: '', maxlength: 5000 })
  response: string;

  /** The admin user who answered — never shown to the customer. */
  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  respondedBy: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  respondedAt: Date | null;

  /**
   * Whether the reply actually left the building. Evently has no email
   * provider configured, so this records what really happened rather than
   * implying a delivery that never took place.
   */
  @Prop({ default: false })
  responseEmailed: boolean;

  createdAt?: Date;
  updatedAt?: Date;
}

export const ContactRequestSchema = SchemaFactory.createForClass(ContactRequest);

// The admin queue: newest first, filtered by status.
ContactRequestSchema.index({ status: 1, createdAt: -1 });
ContactRequestSchema.index({ createdAt: -1 });
