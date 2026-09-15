import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { createHmac, timingSafeEqual } from 'crypto';
import Razorpay from 'razorpay';
import { Model, Types } from 'mongoose';
import { BookingService } from '../booking/booking.service';
import { CouponService } from '../coupon/coupon.service';
import { QuoteService } from '../quote/quote.service';
import {
  PaymentOrder,
  PaymentOrderDocument,
  PaymentOrderStatus,
} from './schemas/payment-order.schema';
import { CreatePaymentOrderDto } from './dto/create-payment-order.dto';
import { VerifyPaymentDto } from './dto/verify-payment.dto';

/** What the app needs to open Razorpay's checkout. */
export interface PaymentOrderView {
  orderId: string;
  /** Paise — what Razorpay's checkout expects. */
  amountInPaise: number;
  currency: 'INR';
  /** The publishable key. The secret never leaves the server. */
  keyId: string;
  /* The same numbers in rupees, so the screen states them without dividing. */
  advanceAmount: number;
  totalAmount: number;
  balanceAmount: number;
  advancePercentage: number;
  couponCode: string;
  couponDiscount: number;
  organizerName: string;
}

const CURRENCY = 'INR' as const;

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);
  private client: Razorpay | null = null;

  constructor(
    @InjectModel(PaymentOrder.name)
    private readonly orderModel: Model<PaymentOrderDocument>,
    private readonly config: ConfigService,
    private readonly quoteService: QuoteService,
    private readonly couponService: CouponService,
    @Inject(forwardRef(() => BookingService))
    private readonly bookingService: BookingService,
  ) {}

  /**
   * Whether a gateway is wired up at all.
   *
   * Read by BookingService too: while this is false the old trust-me booking
   * route keeps working, and the moment keys are configured that route starts
   * demanding a paid order instead. One switch, both paths.
   */
  isConfigured(): boolean {
    return Boolean(this.keyId() && this.keySecret());
  }

  /**
   * What the customer is about to pay, and the Razorpay order to pay it with.
   *
   * Everything is recomputed here from the quotation: `getBookingSeed` checks
   * the quotation is this customer's and has been accepted, and the coupon is
   * re-evaluated through the same validator the booking write uses. The client
   * sends a quotation id and at most a coupon code — never a number.
   */
  async createOrder(userId: string, dto: CreatePaymentOrderDto): Promise<PaymentOrderView> {
    this.assertConfigured();

    const seed = await this.quoteService.getBookingSeed(userId, dto.quotationId);

    const quote = dto.couponCode
      ? await this.couponService.evaluate(
          { customerId: seed.customerId, organizerId: seed.organizerId, amount: seed.amount },
          dto.couponCode,
        )
      : null;

    const totalAmount = quote ? quote.finalAmount : seed.amount;
    const advanceAmount = Math.round((totalAmount * seed.advancePercentage) / 100);
    if (advanceAmount < 1) {
      throw new BadRequestException('This quotation has nothing left to pay.');
    }

    const order = await this.razorpay().orders.create({
      amount: advanceAmount * 100,
      currency: CURRENCY,
      /* Razorpay caps receipts at 40 characters; a bare ObjectId is 24. */
      receipt: dto.quotationId,
      notes: { quotationId: dto.quotationId, customerId: seed.customerId },
    });

    await this.orderModel.create({
      customer: new Types.ObjectId(seed.customerId),
      quotation: new Types.ObjectId(dto.quotationId),
      razorpayOrderId: order.id,
      amount: advanceAmount,
      totalAmount,
      advancePercentage: seed.advancePercentage,
      couponCode: quote ? quote.code : '',
      couponDiscount: quote ? quote.discountAmount : 0,
      status: PaymentOrderStatus.CREATED,
    });

    return {
      orderId: order.id,
      amountInPaise: advanceAmount * 100,
      currency: CURRENCY,
      keyId: this.keyId(),
      advanceAmount,
      totalAmount,
      balanceAmount: Math.max(0, totalAmount - advanceAmount),
      advancePercentage: seed.advancePercentage,
      couponCode: quote ? quote.code : '',
      couponDiscount: quote ? quote.discountAmount : 0,
      organizerName: await this.organizerNameFor(seed.organizerId),
    };
  }

  /**
   * Confirms a payment the app says succeeded, then writes the booking.
   *
   * The signature is the whole check: it is an HMAC of `order_id|payment_id`
   * under the key secret, which only Razorpay and this server can produce. A
   * client claiming a payment it never made fails here, and no booking exists.
   */
  async verifyAndBook(userId: string, dto: VerifyPaymentDto): Promise<Record<string, unknown>> {
    this.assertConfigured();

    const order = await this.orderModel.findOne({ razorpayOrderId: dto.razorpayOrderId }).exec();
    if (!order) throw new NotFoundException('Payment not found');
    if (order.customer.toString() !== userId) {
      throw new ForbiddenException('This payment is not yours');
    }

    if (!this.signatureMatches(dto.razorpayOrderId, dto.razorpayPaymentId, dto.razorpaySignature)) {
      order.status = PaymentOrderStatus.FAILED;
      order.failureReason = 'Signature did not verify';
      await order.save();
      throw new BadRequestException('We could not verify that payment.');
    }

    return this.settle(order, dto.razorpayPaymentId);
  }

  /**
   * Razorpay's own account of what happened.
   *
   * Authoritative, and deliberately independent of the app: a customer whose
   * phone died between paying and the app confirming still gets their booking,
   * because this arrives regardless. Idempotent, so the webhook and the app's
   * own verification cannot produce two bookings.
   */
  async handleWebhook(rawBody: Buffer | string, signature: string): Promise<{ handled: boolean }> {
    const secret = this.config.get<string>('razorpay.webhookSecret') ?? '';
    if (!secret) throw new ServiceUnavailableException('Webhooks are not configured.');

    const body = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
    if (!matches(createHmac('sha256', secret).update(body).digest('hex'), signature)) {
      throw new BadRequestException('Invalid webhook signature');
    }

    const event = JSON.parse(body) as {
      event?: string;
      payload?: {
        payment?: { entity?: { id?: string; order_id?: string; error_description?: string } };
      };
    };
    const entity = event.payload?.payment?.entity;
    if (!entity?.order_id) return { handled: false };

    const order = await this.orderModel.findOne({ razorpayOrderId: entity.order_id }).exec();
    if (!order) return { handled: false };

    if (event.event === 'payment.captured') {
      await this.settle(order, entity.id ?? '');
      return { handled: true };
    }

    if (event.event === 'payment.failed' && order.status === PaymentOrderStatus.CREATED) {
      order.status = PaymentOrderStatus.FAILED;
      order.failureReason = entity.error_description ?? 'Payment failed';
      await order.save();
      return { handled: true };
    }

    return { handled: false };
  }

  /**
   * Gives the advance back, when the booking it paid for did not happen.
   *
   * An organizer who declines, or who never answers inside their 48 hours,
   * leaves a customer who has paid for nothing. The payment screen says the
   * advance comes back in that case, and this is what makes that true rather
   * than a sentence.
   *
   * Claimed with a conditional update so a booking cancelled twice — or
   * cancelled and expired — refunds once. Best-effort by design: a refund that
   * Razorpay refuses must not stop the booking being cancelled, because the
   * customer still needs the cancellation to go through. It is logged loudly
   * instead, since somebody then has to refund it by hand.
   */
  async refundForBooking(bookingId: string, reason: string): Promise<void> {
    if (!this.isConfigured() || !Types.ObjectId.isValid(bookingId)) return;

    const claimed = await this.orderModel
      .findOneAndUpdate(
        {
          booking: new Types.ObjectId(bookingId),
          status: PaymentOrderStatus.PAID,
          razorpayPaymentId: { $ne: '' },
        },
        { status: PaymentOrderStatus.REFUNDED, refundedAt: new Date() },
        { new: true },
      )
      .exec();
    if (!claimed) return;

    try {
      const refund = await this.razorpay().payments.refund(claimed.razorpayPaymentId, {
        amount: claimed.amount * 100,
        speed: 'normal',
        notes: { bookingId, reason },
      });
      await this.orderModel
        .findByIdAndUpdate(claimed._id, { razorpayRefundId: refund.id ?? '' })
        .exec();
      this.logger.log(`Refunded ${claimed.amount} for booking ${bookingId} (${reason}).`);
    } catch (error) {
      /*
       * Put it back to PAID so the state does not claim a refund that never
       * happened, and say so loudly — this one needs a human.
       */
      await this.orderModel
        .findByIdAndUpdate(claimed._id, { status: PaymentOrderStatus.PAID, refundedAt: null })
        .exec();
      this.logger.error(
        `REFUND FAILED for booking ${bookingId}, payment ${claimed.razorpayPaymentId}: ${String(error)}`,
      );
    }
  }

  /** The paid order behind a booking attempt, or null. Read by BookingService. */
  async paidOrderFor(orderId: string): Promise<PaymentOrderDocument | null> {
    if (!Types.ObjectId.isValid(orderId)) return null;
    return this.orderModel.findById(orderId).exec();
  }

  // ---------------------------------------------------------------------------

  /**
   * Marks the order paid and writes the booking, once.
   *
   * The order is claimed with a conditional update, so the app's verification
   * and the webhook arriving at the same moment cannot both go on to book —
   * one of them matches nothing and simply returns the booking the other made.
   */
  private async settle(
    order: PaymentOrderDocument,
    paymentId: string,
  ): Promise<Record<string, unknown>> {
    const claimed = await this.orderModel
      .findOneAndUpdate(
        { _id: order._id, status: PaymentOrderStatus.CREATED },
        {
          status: PaymentOrderStatus.PAID,
          razorpayPaymentId: paymentId,
          paidAt: new Date(),
        },
        { new: true },
      )
      .exec();

    const settled = claimed ?? order;

    /*
     * Booking creation is idempotent per quotation, so a repeat here returns
     * the booking that already exists rather than making a second one.
     */
    const booking = await this.bookingService.createFromQuotation(
      settled.customer.toString(),
      {
        quotationId: settled.quotation.toString(),
        ...(settled.couponCode ? { couponCode: settled.couponCode } : {}),
      },
      settled._id.toString(),
    );

    /*
     * Linking the payment to the booking is bookkeeping, and bookkeeping must
     * never be able to fail a payment that has already gone through. By this
     * point the money has moved and the event exists; if this write throws,
     * the customer still has their booking and support still has the order.
     */
    const bookingId = (booking as { id?: string }).id;
    if (bookingId && !settled.booking && Types.ObjectId.isValid(bookingId)) {
      try {
        await this.orderModel
          .findByIdAndUpdate(settled._id, { booking: new Types.ObjectId(bookingId) })
          .exec();
      } catch (error) {
        this.logger.warn(
          `Could not link payment ${settled._id.toString()} to booking ${bookingId}: ${String(error)}`,
        );
      }
    }

    return booking;
  }

  private signatureMatches(orderId: string, paymentId: string, signature: string): boolean {
    const expected = createHmac('sha256', this.keySecret())
      .update(`${orderId}|${paymentId}`)
      .digest('hex');
    return matches(expected, signature);
  }

  private async organizerNameFor(organizerId: string | null): Promise<string> {
    if (!organizerId) return 'your organizer';
    try {
      return (await this.quoteService.organizerNameById(organizerId)) || 'your organizer';
    } catch {
      return 'your organizer';
    }
  }

  private razorpay(): Razorpay {
    if (!this.client) {
      this.client = new Razorpay({ key_id: this.keyId(), key_secret: this.keySecret() });
    }
    return this.client;
  }

  private keyId(): string {
    return this.config.get<string>('razorpay.keyId') ?? '';
  }

  private keySecret(): string {
    return this.config.get<string>('razorpay.keySecret') ?? '';
  }

  /**
   * Refuses clearly rather than half-working.
   *
   * A payment screen that silently does nothing is the worst of both worlds;
   * this at least tells whoever is testing exactly what is missing.
   */
  private assertConfigured(): void {
    if (this.isConfigured()) return;
    this.logger.error('Razorpay keys are not configured — payments cannot be taken.');
    throw new ServiceUnavailableException(
      'Payments are not available right now. Please try again shortly.',
    );
  }
}

/** Constant-time compare — a signature check must not leak by timing. */
function matches(expected: string, given: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(given ?? '', 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}
