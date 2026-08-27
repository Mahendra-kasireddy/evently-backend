import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { idJsonTransform } from '../../../common/utils/id-transform';
import { HydratedDocument, Types } from 'mongoose';

export type QuoteRequestDocument = HydratedDocument<QuoteRequest>;

export enum QuoteRequestStatus {
  OPEN = 'open', // awaiting organizer quotes
  QUOTED = 'quoted', // at least one quote received
  ACCEPTED = 'accepted', // customer accepted a quotation
  CANCELLED = 'cancelled', // customer cancelled the request
  CLOSED = 'closed',
}

@Schema({
  timestamps: true,
  collection: 'quote_requests',
  toJSON: idJsonTransform(),
})
export class QuoteRequest {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  customer: Types.ObjectId;

  // Set when the request targets one specific organizer ("Get quote" on a card).
  // Null for an open request broadcast to matched organizers ("Get quotes").
  @Prop({ type: Types.ObjectId, ref: 'OrganizerProfile', default: null, index: true })
  organizer: Types.ObjectId | null;

  /*
   * The Plan wizard submission this request came from, when there is one.
   *
   * Without it, one real event existed as three unrelated records — a plan, a
   * request and a booking — and My Events listed the same celebration three
   * times under two different names with nothing saying they were the same
   * thing. The booking already points at its request; this closes the chain
   * back to the plan. Null for the Home hero's quick "Get quotes" draft, which
   * never creates a plan document.
   */
  @Prop({ type: Types.ObjectId, ref: 'PlanSubmission', default: null, index: true })
  plan: Types.ObjectId | null;

  // Captured from the hero draft (display strings, as the user picked them).
  @Prop({ required: true, trim: true })
  occasion: string;

  @Prop({ trim: true, default: '' })
  when: string;

  /** "Area, City" — bounded to match RequestQuotesDto rather than left open. */
  @Prop({ trim: true, default: '', maxlength: 120 })
  where: string;

  @Prop({ trim: true, default: '' })
  guests: string;

  // The following three are carried over from the Plan wizard's richer draft
  // (see PlanSubmission) when the request originates there — the Home hero's
  // quick "Get quotes" draft doesn't collect them, so they stay empty/[] for
  // that path. Duplicated onto the request itself (not joined) so an
  // organizer can price a quote without any dependency on the customer's
  // plan document surviving or changing.
  @Prop({ trim: true, default: '' })
  budget: string;

  @Prop({ type: [String], default: [] })
  categories: string[];

  @Prop({ trim: true, default: '', maxlength: 5000 })
  ideas: string;

  @Prop({ type: String, enum: QuoteRequestStatus, default: QuoteRequestStatus.OPEN, index: true })
  status: QuoteRequestStatus;

  // Provided by { timestamps: true } — declared so they are typed on the document.
  createdAt?: Date;
  updatedAt?: Date;
}

export const QuoteRequestSchema = SchemaFactory.createForClass(QuoteRequest);

QuoteRequestSchema.index({ customer: 1, createdAt: -1 });
