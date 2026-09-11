import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { idJsonTransform } from '../../../common/utils/id-transform';
import { Role } from '../../../common/enums/role.enum';

export type CouponDocument = HydratedDocument<Coupon>;

/**
 * Who a coupon belongs to, and therefore what it may be spent on.
 *
 * A platform coupon is the marketplace's own money off any booking; an
 * organizer coupon is one organizer discounting their own work. There is no
 * third case, and the scope is what the validator checks a booking against —
 * an organizer coupon can never be applied to somebody else's quotation.
 */
export enum CouponScope {
  PLATFORM = 'platform',
  ORGANIZER = 'organizer',
}

export enum CouponDiscountType {
  PERCENTAGE = 'percentage',
  FIXED = 'fixed',
}

/**
 * Whether the coupon may be used at all.
 *
 * Deliberately two states and no "expired": whether a coupon has expired is
 * decided by `endsAt` against the clock, and storing it as a status would mean
 * a second source of truth that a cron job has to keep in step with the first.
 */
export enum CouponStatus {
  ACTIVE = 'active',
  DISABLED = 'disabled',
}

/**
 * A discount a customer can apply to a booking.
 *
 * Organizer coupons go live the moment they are created — no admin approval.
 * That mirrors the pricing authority organizers already have: they author their
 * own quotation totals (`POST /quote/respond`, `PATCH /quote/updateQuotation`)
 * with no admin review, and the platform's commission is a function of their
 * tier (`organizer/tier-config.ts`), not of the price they charge. An approval
 * queue would gate the one way of discounting that needs asking, while leaving
 * open the one that does not — quoting a lower number in the first place.
 */
@Schema({
  timestamps: true,
  collection: 'coupons',
  toJSON: idJsonTransform(),
})
export class Coupon {
  /**
   * The code the customer types, stored upper-cased and trimmed.
   *
   * Unique across the whole platform rather than per organizer: the customer
   * types a code at checkout without saying whose it is, so two organizers
   * owning "DIWALI20" would make that box ambiguous.
   */
  @Prop({ required: true, trim: true, uppercase: true })
  code: string;

  @Prop({ required: true, trim: true, maxlength: 80 })
  title: string;

  @Prop({ trim: true, default: '', maxlength: 300 })
  description: string;

  @Prop({ type: String, enum: CouponScope, required: true, index: true })
  scope: CouponScope;

  /** Set for, and only for, `scope: organizer`. Enforced in the service. */
  @Prop({ type: Types.ObjectId, ref: 'OrganizerProfile', default: null, index: true })
  organizer: Types.ObjectId | null;

  @Prop({ type: String, enum: CouponDiscountType, required: true })
  discountType: CouponDiscountType;

  /** Percent (1–100) or rupees off, depending on `discountType`. */
  @Prop({ required: true, min: 0 })
  discountValue: number;

  /**
   * Rupee ceiling on a percentage discount; 0 means uncapped.
   *
   * The reason percentage coupons need one: 20% of a ₹6,00,000 wedding is
   * ₹1,20,000, which is not what anybody means by "20% off".
   */
  @Prop({ default: 0, min: 0 })
  maxDiscount: number;

  @Prop({ default: 0, min: 0 })
  minBookingAmount: number;

  /** Null means "no start" / "no end" — an open-ended window. */
  @Prop({ type: Date, default: null })
  startsAt: Date | null;

  @Prop({ type: Date, default: null, index: true })
  endsAt: Date | null;

  /** Total redemptions allowed across every customer. 0 means unlimited. */
  @Prop({ default: 0, min: 0 })
  usageLimit: number;

  /** Redemptions allowed per customer. 0 means unlimited. */
  @Prop({ default: 1, min: 0 })
  perCustomerLimit: number;

  /**
   * Redemptions taken so far.
   *
   * A cache of the redemption collection, not the record of it — it exists so
   * the limit can be claimed in one atomic write. `CouponRedemption` is the
   * ledger, and the admin usage screen reads that, never this.
   */
  @Prop({ default: 0, min: 0 })
  usedCount: number;

  @Prop({ type: String, enum: CouponStatus, default: CouponStatus.ACTIVE, index: true })
  status: CouponStatus;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  createdBy: Types.ObjectId;

  @Prop({ type: String, enum: Role, required: true })
  createdByRole: Role;

  createdAt?: Date;
  updatedAt?: Date;
}

export const CouponSchema = SchemaFactory.createForClass(Coupon);

/** One coupon per code, enforced by the database rather than by a lookup. */
CouponSchema.index({ code: 1 }, { unique: true });

/** The customer's "which coupons can I use here" query, in one index. */
CouponSchema.index({ status: 1, scope: 1, organizer: 1, endsAt: 1 });
