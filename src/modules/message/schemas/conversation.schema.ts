import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { idJsonTransform } from '../../../common/utils/id-transform';

export type ConversationDocument = HydratedDocument<Conversation>;

/**
 * One thread between a customer and an organizer.
 *
 * One per pair, not one per booking: a customer who books the same organizer
 * twice is still talking to the same person, and splitting the history across
 * bookings would hide what was agreed the first time. The unique index below
 * enforces that at the database rather than by a check the service could lose
 * a race on — two "message this organizer" taps at once would otherwise create
 * two threads and split the conversation in half.
 */
@Schema({
  timestamps: true,
  collection: 'conversations',
  toJSON: idJsonTransform(),
})
export class Conversation {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  customer: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'OrganizerProfile', required: true, index: true })
  organizer: Types.ObjectId;

  /**
   * The organizer's own user account.
   *
   * Denormalised because every organizer-side query is "threads for the signed
   * in user", and resolving a profile to its user on each one would be a join
   * on the hot path of their inbox.
   */
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  organizerUser: Types.ObjectId;

  /** A preview for the inbox, so listing threads needs no message lookup. */
  @Prop({ trim: true, default: '', maxlength: 200 })
  lastMessageText: string;

  @Prop({ type: Date, default: null, index: true })
  lastMessageAt: Date | null;

  /**
   * Unread counts, one per side.
   *
   * Stored rather than counted because the tab badge asks for this on every
   * app open, and counting unread messages across every thread would get
   * slower for exactly the customers who use the app most.
   */
  @Prop({ default: 0, min: 0 })
  customerUnread: number;

  @Prop({ default: 0, min: 0 })
  organizerUnread: number;

  createdAt?: Date;
  updatedAt?: Date;
}

export const ConversationSchema = SchemaFactory.createForClass(Conversation);

/** One thread per customer/organizer pair. */
ConversationSchema.index({ customer: 1, organizer: 1 }, { unique: true });
