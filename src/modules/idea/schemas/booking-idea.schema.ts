import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { idJsonTransform } from '../../../common/utils/id-transform';

export type BookingIdeaDocument = HydratedDocument<BookingIdea>;

/** What kind of post this is — drives the chip on the board. */
export enum IdeaType {
  IDEA = 'idea',
  SURPRISE = 'surprise',
  QUESTION = 'question',
  INSPIRATION = 'inspiration',
  /** Organizer-authored: a status note back to the customer. */
  UPDATE = 'update',
}

/** Who wrote the post. */
export enum IdeaAuthorRole {
  CUSTOMER = 'customer',
  ORGANIZER = 'organizer',
}

/** How far the organizer has taken the idea. */
export enum IdeaPlanStatus {
  PLANNED = 'planned',
  IN_PROGRESS = 'in_progress',
  DONE = 'done',
}

/**
 * Whether this post is waiting on the customer.
 *
 * `NONE` is the default: most posts are conversation, not a decision. The
 * organizer sets `PENDING` when they need a sign-off, and the customer's
 * approval is the only thing that moves it to `APPROVED` — which is what the
 * workspace's "awaiting your approval" count is derived from.
 */
export enum IdeaApproval {
  NONE = 'none',
  PENDING = 'pending',
  APPROVED = 'approved',
}

/** An uploaded reference image, matching the shape the upload module returns. */
@Schema({ _id: false })
export class IdeaImage {
  @Prop({ required: true, trim: true })
  url: string;

  @Prop({ trim: true, default: '' })
  key: string;

  @Prop({ trim: true, default: '' })
  originalName: string;
}

/** The organizer's reply, turning an idea into a plan. */
@Schema({ _id: false })
export class IdeaReply {
  @Prop({ type: String, enum: IdeaPlanStatus, required: true })
  status: IdeaPlanStatus;

  @Prop({ required: true, trim: true, maxlength: 4000 })
  text: string;

  @Prop({ type: Date, default: null })
  at: Date | null;
}

/**
 * One post on a booking's ideas & planning board.
 *
 * The board is per booking, and scoped to the two parties on it: the customer
 * who owns the booking and the organizer delivering it. `confidential` exists
 * for the "surprise" case in the design — something the customer wants planned
 * without it appearing in anything they might share.
 */
@Schema({
  timestamps: true,
  collection: 'booking_ideas',
  toJSON: idJsonTransform(),
})
export class BookingIdea {
  @Prop({ type: Types.ObjectId, ref: 'Booking', required: true, index: true })
  booking: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  author: Types.ObjectId;

  @Prop({ type: String, enum: IdeaAuthorRole, required: true })
  authorRole: IdeaAuthorRole;

  /** Denormalised so the board reads correctly even if the profile changes. */
  @Prop({ trim: true, default: '' })
  authorName: string;

  @Prop({ type: String, enum: IdeaType, default: IdeaType.IDEA })
  type: IdeaType;

  @Prop({ required: true, trim: true, maxlength: 4000 })
  text: string;

  @Prop({ type: [IdeaImage], default: [] })
  images: IdeaImage[];

  /** Keep out of anything shared beyond the customer and organizer. */
  @Prop({ default: false })
  confidential: boolean;

  @Prop({ type: IdeaReply, default: null })
  reply: IdeaReply | null;

  @Prop({ type: String, enum: IdeaApproval, default: IdeaApproval.NONE, index: true })
  approval: IdeaApproval;

  /** What exactly the customer is being asked to approve. */
  @Prop({ trim: true, default: '', maxlength: 400 })
  approvalLabel: string;

  @Prop({ type: Date, default: null })
  approvedAt: Date | null;

  createdAt?: Date;
  updatedAt?: Date;
}

export const BookingIdeaSchema = SchemaFactory.createForClass(BookingIdea);

BookingIdeaSchema.index({ booking: 1, createdAt: -1 });
