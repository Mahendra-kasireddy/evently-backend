import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { idJsonTransform } from '../../../common/utils/id-transform';

export type PaymentOrderDocument = HydratedDocument<PaymentOrder>;

/**
 * Where a payment attempt has got to.
 *
 * `CREATED` is an order Razorpay has issued and nobody has paid; it is not a
 * promise of anything. Only `PAID` may be spent on a booking.
 */
export enum PaymentOrderStatus {
  CREATED = 'created',
  PAID = 'paid',
  FAILED = 'failed',
  /** Given back, because the booking it paid for never happened. */
  REFUNDED = 'refunded',
}

/**
 * One attempt to pay the advance on a quotation.
 *
 * The amounts are decided here, on the server, from the quotation and the
 * coupon — never from the client. A client that could name its own amount
 * could book a ₹7,00,000 wedding for ₹1.
 *
 * This record is also what makes the booking honest: `BookingService` will not
 * write a booking without a PAID order that belongs to the same customer and
 * quotation, so "advance paid" stops meaning "somebody called the endpoint".
 */
@Schema({
  timestamps: true,
  collection: 'payment_orders',
  toJSON: idJsonTransform(),
})
export class PaymentOrder {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  customer: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Quotation', required: true, index: true })
  quotation: Types.ObjectId;

  /** Razorpay's order id (`order_...`), unique per attempt. */
  @Prop({ required: true, trim: true })
  razorpayOrderId: string;

  /** Razorpay's payment id (`pay_...`), known only once it is paid. */
  @Prop({ trim: true, default: '' })
  razorpayPaymentId: string;

  /**
   * What is being collected now, in rupees — the advance share of the
   * discounted total. Razorpay is charged this × 100, in paise.
   */
  @Prop({ required: true, min: 1 })
  amount: number;

  /** The whole event's price after any coupon, for the receipt's context. */
  @Prop({ required: true, min: 0 })
  totalAmount: number;

  @Prop({ required: true, min: 0, max: 100 })
  advancePercentage: number;

  /** Snapshotted so a coupon edited later cannot change what was charged. */
  @Prop({ trim: true, default: '' })
  couponCode: string;

  @Prop({ default: 0, min: 0 })
  couponDiscount: number;

  @Prop({
    type: String,
    enum: PaymentOrderStatus,
    default: PaymentOrderStatus.CREATED,
    index: true,
  })
  status: PaymentOrderStatus;

  /**
   * The booking this payment was spent on.
   *
   * Set when the booking is written, so one paid order cannot be redeemed for
   * two bookings — and so a support question about a payment can be answered
   * without guessing which event it belongs to.
   */
  @Prop({ type: Types.ObjectId, ref: 'Booking', default: null, index: true })
  booking: Types.ObjectId | null;

  /** Razorpay's own reason, kept verbatim for support. */
  @Prop({ trim: true, default: '' })
  failureReason: string;

  @Prop({ type: Date, default: null })
  paidAt: Date | null;

  /**
   * The refund, when the booking this paid for did not survive.
   *
   * An organizer who declines, or never answers inside their window, leaves a
   * customer who has paid for nothing — so the advance goes back. Recorded
   * here rather than inferred from the status alone, because support needs
   * Razorpay's own id for it.
   */
  @Prop({ trim: true, default: '' })
  razorpayRefundId: string;

  @Prop({ type: Date, default: null })
  refundedAt: Date | null;

  createdAt?: Date;
  updatedAt?: Date;
}

export const PaymentOrderSchema = SchemaFactory.createForClass(PaymentOrder);

/** One record per Razorpay order — the webhook and the client both key on it. */
PaymentOrderSchema.index({ razorpayOrderId: 1 }, { unique: true });
