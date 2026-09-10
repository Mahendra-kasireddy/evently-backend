import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { idJsonTransform } from '../../../common/utils/id-transform';

export type OfferDocument = HydratedDocument<Offer>;

/** How an offer card is coloured. Not a discount type — see `terms`. */
export enum OfferTone {
  ACCENT = 'accent',
  NAVY = 'navy',
}

/**
 * A promotion shown on the customer home screen.
 *
 * Deliberately descriptive, not executable. Nothing in this system can yet
 * apply a discount to a quotation or a booking, so an offer here is an
 * announcement with terms and a window — the customer reads it and raises it
 * with their organizer. Storing a `percentOff` that no code ever subtracted
 * would be a promise the platform cannot keep, so there is no such field.
 *
 * `startsAt` and `endsAt` are what make it honest: an offer nobody removed on
 * time is worse than no offer, and the customer query filters on them rather
 * than trusting somebody to flip `active` the morning it expires.
 */
@Schema({
  timestamps: true,
  collection: 'offers',
  toJSON: idJsonTransform(),
})
export class Offer {
  /** The small line above the headline, e.g. "FESTIVE SEASON". */
  @Prop({ required: true, trim: true, maxlength: 40 })
  eyebrow: string;

  /** The headline, e.g. "10% off decor". */
  @Prop({ required: true, trim: true, maxlength: 80 })
  title: string;

  /** The condition, in the customer's words, e.g. "On events confirmed before 30 September". */
  @Prop({ trim: true, default: '', maxlength: 200 })
  terms: string;

  /** What the card's link says, e.g. "Claim offer". */
  @Prop({ trim: true, default: 'See details', maxlength: 30 })
  ctaLabel: string;

  @Prop({ type: String, enum: OfferTone, default: OfferTone.ACCENT })
  tone: OfferTone;

  /** Live from this moment. Null means it has always been live. */
  @Prop({ type: Date, default: null, index: true })
  startsAt: Date | null;

  /** Live until this moment. Null means it does not expire on its own. */
  @Prop({ type: Date, default: null, index: true })
  endsAt: Date | null;

  /** Carousel ordering (lower shows first). */
  @Prop({ default: 0, index: true })
  order: number;

  /** The manual switch, on top of the window. */
  @Prop({ default: true, index: true })
  active: boolean;

  createdAt?: Date;
  updatedAt?: Date;
}

export const OfferSchema = SchemaFactory.createForClass(Offer);
