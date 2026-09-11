import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { idJsonTransform } from '../../../common/utils/id-transform';

export type CouponRedemptionDocument = HydratedDocument<CouponRedemption>;

export enum RedemptionStatus {
  REDEEMED = 'redeemed',
  /** The booking it paid for never happened — the slot was given back. */
  REVERSED = 'reversed',
}

/**
 * One coupon, spent once, on one booking.
 *
 * This is the ledger. `Coupon.usedCount` is only a counter that lets the limit
 * be claimed atomically; every question worth asking — who used it, on what,
 * for how much, when — is answered from here, so a lost or drifted counter can
 * never turn into a lost audit trail.
 *
 * The money is snapshotted rather than recomputed: the coupon's terms can be
 * edited afterwards, and a redemption has to keep saying what was actually
 * charged on the day.
 *
 * There is no separate payment record to point at. In this codebase creating
 * the booking *is* the advance payment — `POST /booking` sets
 * `paymentStatus: ADVANCE_PAID` because it was called — so the booking is the
 * payment, and one reference covers both.
 */
@Schema({
  timestamps: true,
  collection: 'coupon_redemptions',
  toJSON: idJsonTransform(),
})
export class CouponRedemption {
  @Prop({ type: Types.ObjectId, ref: 'Coupon', required: true, index: true })
  coupon: Types.ObjectId;

  /** The code as typed on the day, so the ledger reads without a join. */
  @Prop({ required: true, trim: true, uppercase: true })
  code: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  customer: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Booking', required: true, index: true })
  booking: Types.ObjectId;

  /** Null for a platform coupon spent on a booking with no organizer. */
  @Prop({ type: Types.ObjectId, ref: 'OrganizerProfile', default: null, index: true })
  organizer: Types.ObjectId | null;

  @Prop({ required: true, min: 0 })
  originalAmount: number;

  @Prop({ required: true, min: 0 })
  discountAmount: number;

  @Prop({ required: true, min: 0 })
  finalAmount: number;

  @Prop({ type: String, enum: RedemptionStatus, default: RedemptionStatus.REDEEMED, index: true })
  status: RedemptionStatus;

  @Prop({ type: Date, default: () => new Date() })
  redeemedAt: Date;

  @Prop({ type: Date, default: null })
  reversedAt: Date | null;

  createdAt?: Date;
  updatedAt?: Date;
}

export const CouponRedemptionSchema = SchemaFactory.createForClass(CouponRedemption);

/**
 * One redemption per coupon per booking.
 *
 * This is what makes redemption idempotent: a retried or duplicated booking
 * write cannot spend the same coupon twice, and the service reads the
 * duplicate-key error as "already redeemed" rather than as a failure.
 */
CouponRedemptionSchema.index({ coupon: 1, booking: 1 }, { unique: true });

/** The per-customer limit check, and the customer's own usage history. */
CouponRedemptionSchema.index({ coupon: 1, customer: 1, status: 1 });
