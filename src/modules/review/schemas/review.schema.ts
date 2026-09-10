import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { idJsonTransform } from '../../../common/utils/id-transform';

export type ReviewDocument = HydratedDocument<Review>;

/**
 * The things a customer can say quickly, as chips.
 *
 * A fixed vocabulary rather than free tags, because the profile counts them
 * ("On time 64") and a count is only meaningful if everybody picked from the
 * same list. Free text still has its place — that is `comment`.
 */
export enum ReviewTag {
  ON_TIME = 'on_time',
  GREAT_DECOR = 'great_decor',
  CLEAR_PRICING = 'clear_pricing',
  GOOD_FOOD = 'good_food',
  RESPONSIVE = 'responsive',
  WELL_COORDINATED = 'well_coordinated',
}

/** Human labels, kept beside the enum so one file owns the vocabulary. */
export const REVIEW_TAG_LABEL: Record<ReviewTag, string> = {
  [ReviewTag.ON_TIME]: 'On time',
  [ReviewTag.GREAT_DECOR]: 'Great decor',
  [ReviewTag.CLEAR_PRICING]: 'Clear pricing',
  [ReviewTag.GOOD_FOOD]: 'Good food',
  [ReviewTag.RESPONSIVE]: 'Responsive',
  [ReviewTag.WELL_COORDINATED]: 'Well coordinated',
};

/**
 * One customer's review of one organizer, for one booking.
 *
 * Anchored to a booking rather than written freely, and that is the whole
 * design: it means a review can only come from someone the organizer actually
 * delivered an event for, the occasion and date are read from the booking
 * rather than typed, and the unique index below makes a second review for the
 * same booking impossible at the database rather than by a check the service
 * could lose a race on.
 *
 * The organizer's `rating` and `reviews` are recomputed from this collection
 * after every write. They are stored on the profile only as a cache for
 * listing screens — this collection is the truth.
 */
@Schema({
  timestamps: true,
  collection: 'reviews',
  toJSON: idJsonTransform(),
})
export class Review {
  @Prop({ type: Types.ObjectId, ref: 'Booking', required: true, index: true })
  booking: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'OrganizerProfile', required: true, index: true })
  organizer: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  customer: Types.ObjectId;

  /** Whole stars only — a 4.5 nobody can select would skew the histogram. */
  @Prop({ required: true, min: 1, max: 5 })
  rating: number;

  @Prop({ trim: true, default: '', maxlength: 1000 })
  comment: string;

  @Prop({ type: [{ type: String, enum: ReviewTag }], default: [] })
  tags: ReviewTag[];

  /**
   * Copied from the booking at the time of writing, not joined.
   *
   * A review card reads "Naming ceremony · June 2026", and both facts belong
   * to the event as it was. Joining them would make an organizer's whole
   * review list depend on bookings that may later be edited or archived.
   */
  @Prop({ trim: true, default: '' })
  occasion: string;

  @Prop({ type: Date, default: null })
  eventDate: Date | null;

  createdAt?: Date;
  updatedAt?: Date;
}

export const ReviewSchema = SchemaFactory.createForClass(Review);

/**
 * One review per booking, enforced by the database.
 *
 * A check-then-write in the service would let two submissions sent at once
 * both find nothing and both insert, and the organizer's average would then
 * count one event twice.
 */
ReviewSchema.index({ booking: 1 }, { unique: true });
