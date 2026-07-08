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

  // Captured from the hero draft (display strings, as the user picked them).
  @Prop({ required: true, trim: true })
  occasion: string;

  @Prop({ trim: true, default: '' })
  when: string;

  @Prop({ trim: true, default: '' })
  where: string;

  @Prop({ trim: true, default: '' })
  guests: string;

  @Prop({ type: String, enum: QuoteRequestStatus, default: QuoteRequestStatus.OPEN, index: true })
  status: QuoteRequestStatus;

  // Provided by { timestamps: true } — declared so they are typed on the document.
  createdAt?: Date;
  updatedAt?: Date;
}

export const QuoteRequestSchema = SchemaFactory.createForClass(QuoteRequest);

QuoteRequestSchema.index({ customer: 1, createdAt: -1 });
