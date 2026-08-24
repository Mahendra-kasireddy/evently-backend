import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { idJsonTransform } from '../../../common/utils/id-transform';
import { HydratedDocument, Types } from 'mongoose';

export type QuotationDocument = HydratedDocument<Quotation>;

/** Lifecycle of an organizer's priced response to a quote request. */
export enum QuotationStatus {
  DRAFT = 'draft', // organizer saved it but hasn't sent it — never visible to the customer
  SENT = 'sent', // organizer submitted the quotation
  UPDATED = 'updated', // organizer revised it
  ACCEPTED = 'accepted', // customer accepted it
  REJECTED = 'rejected', // customer rejected it (or a sibling was accepted)
  WITHDRAWN = 'withdrawn', // organizer pulled it back
}

/** A single priced line on a quotation, e.g. "Food / Catering — ₹1,05,000". */
@Schema({ _id: false })
export class QuotationLine {
  @Prop({ trim: true, default: '' })
  key: string; // category key (drives the FE icon), e.g. "food"

  @Prop({ required: true, trim: true })
  title: string;

  @Prop({ trim: true, default: '' })
  subtitle: string;

  @Prop({ required: true, min: 0 })
  price: number;

  @Prop({ trim: true, default: '' })
  note: string;

  // Optional detail rows shown when the line is expanded.
  @Prop({
    type: [{ label: String, value: String }],
    default: [],
    _id: false,
  })
  subItems: Array<{ label: string; value: string }>;
}
export const QuotationLineSchema = SchemaFactory.createForClass(QuotationLine);

@Schema({
  timestamps: true,
  collection: 'quotations',
  toJSON: idJsonTransform(),
})
export class Quotation {
  // The customer's request this quotation answers.
  @Prop({ type: Types.ObjectId, ref: 'QuoteRequest', required: true, index: true })
  request: Types.ObjectId;

  // The organizer profile that authored it.
  @Prop({ type: Types.ObjectId, ref: 'OrganizerProfile', required: true, index: true })
  organizer: Types.ObjectId;

  // Denormalized owning customer, so a customer can query their quotations directly.
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  customer: Types.ObjectId;

  @Prop({ type: [QuotationLineSchema], default: [] })
  lineItems: QuotationLine[];

  // Money is stored as numbers (rupees); the client formats for display.
  @Prop({ default: 0, min: 0 })
  subtotal: number;

  @Prop({ default: 18, min: 0 })
  taxRate: number; // percent

  @Prop({ default: 0, min: 0 })
  taxAmount: number;

  @Prop({ default: 0, min: 0 })
  grandTotal: number;

  @Prop({ trim: true, default: '', maxlength: 2000 })
  notes: string;

  // Share of the grand total the customer pays up front to confirm the booking.
  // Quoted per-quotation rather than read from the organizer profile, because
  // organizers routinely vary it by event size.
  @Prop({ default: 30, min: 0, max: 100 })
  advancePercentage: number;

  // Organizer flagged this event as warranting an on-site visit before the
  // final plan is locked; surfaced to the customer alongside the quote.
  @Prop({ default: false })
  siteVisitSuggested: boolean;

  @Prop({ type: String, enum: QuotationStatus, default: QuotationStatus.SENT, index: true })
  status: QuotationStatus;

  // Provided by { timestamps: true } — declared so they are typed on the document.
  createdAt?: Date;
  updatedAt?: Date;
}

export const QuotationSchema = SchemaFactory.createForClass(Quotation);

// A customer comparing quotations for one request; newest first.
QuotationSchema.index({ request: 1, createdAt: -1 });
// An organizer listing the quotations they've authored.
QuotationSchema.index({ organizer: 1, createdAt: -1 });
