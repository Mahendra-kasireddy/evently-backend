import {
  BadRequestException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHmac } from 'crypto';
import { Types } from 'mongoose';
import { PaymentService } from './payment.service';
import { PaymentOrderStatus } from './schemas/payment-order.schema';

/**
 * Taking money.
 *
 * The tests worth having here are the ones that stop a booking existing that
 * nobody paid for: a forged signature, somebody else's payment, and the race
 * between the app confirming a payment and Razorpay's webhook reporting the
 * same one.
 */

jest.mock('razorpay', () =>
  jest.fn().mockImplementation(() => ({ orders: { create: jest.fn() } })),
);

const KEY_ID = 'rzp_test_key';
const KEY_SECRET = 'rzp_test_secret';
const WEBHOOK_SECRET = 'hook_secret';

const CUSTOMER = new Types.ObjectId();
const QUOTATION = new Types.ObjectId();

/** A signature Razorpay would have produced for this order and payment. */
const sign = (orderId: string, paymentId: string) =>
  createHmac('sha256', KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');

type OrderLike = Record<string, unknown>;

const order = (over: OrderLike = {}): OrderLike => ({
  _id: new Types.ObjectId(),
  customer: CUSTOMER,
  quotation: QUOTATION,
  razorpayOrderId: 'order_ABC',
  amount: 205200,
  totalAmount: 684000,
  advancePercentage: 30,
  couponCode: '',
  couponDiscount: 0,
  status: PaymentOrderStatus.CREATED,
  booking: null,
  save: jest.fn().mockResolvedValue(undefined),
  ...over,
});

/**
 * A service wired to stubs.
 *
 * `configured` decides whether keys exist, because "no gateway" is a state the
 * whole flow has to behave sanely in — it is the state the app is in today.
 */
function serviceWith(found: OrderLike | null, { configured = true } = {}) {
  const orderModel = {
    findOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(found) }),
    findById: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(found) }),
    // By default the claim succeeds — the caller that gets there first.
    findOneAndUpdate: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(found) }),
    findByIdAndUpdate: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(found) }),
    create: jest.fn().mockResolvedValue(found),
  };

  const values: Record<string, string> = configured
    ? {
        'razorpay.keyId': KEY_ID,
        'razorpay.keySecret': KEY_SECRET,
        'razorpay.webhookSecret': WEBHOOK_SECRET,
      }
    : { 'razorpay.keyId': '', 'razorpay.keySecret': '', 'razorpay.webhookSecret': '' };

  const config = { get: jest.fn((key: string) => values[key] ?? '') };
  const bookingService = { createFromQuotation: jest.fn().mockResolvedValue({ id: 'bk1' }) };

  const service = new PaymentService(
    orderModel as never,
    config as never,
    {} as never,
    {} as never,
    bookingService as never,
  );
  return { service, orderModel, bookingService };
}

describe('configuration', () => {
  it('knows whether a gateway exists at all', () => {
    expect(serviceWith(null).service.isConfigured()).toBe(true);
    expect(serviceWith(null, { configured: false }).service.isConfigured()).toBe(false);
  });

  it('refuses to take a payment it cannot take, rather than half-working', async () => {
    // A payment screen that silently does nothing is worse than one that says
    // it cannot take money right now.
    const { service } = serviceWith(null, { configured: false });
    await expect(
      service.createOrder(CUSTOMER.toString(), { quotationId: QUOTATION.toString() }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

describe('verifying a payment', () => {
  const dto = (over: Partial<Record<string, string>> = {}) => ({
    razorpayOrderId: 'order_ABC',
    razorpayPaymentId: 'pay_XYZ',
    razorpaySignature: sign('order_ABC', 'pay_XYZ'),
    ...over,
  });

  it('books the event when the signature is Razorpay’s', async () => {
    const { service, bookingService } = serviceWith(order());

    await expect(service.verifyAndBook(CUSTOMER.toString(), dto())).resolves.toEqual({ id: 'bk1' });
    expect(bookingService.createFromQuotation).toHaveBeenCalledTimes(1);
  });

  it('refuses a forged signature, and books nothing', async () => {
    // This is the whole check: only Razorpay and this server can produce it.
    const row = order();
    const { service, bookingService } = serviceWith(row);

    await expect(
      service.verifyAndBook(CUSTOMER.toString(), dto({ razorpaySignature: 'deadbeef' })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(bookingService.createFromQuotation).not.toHaveBeenCalled();
    expect(row.status).toBe(PaymentOrderStatus.FAILED);
  });

  it('refuses a signature for a different payment', async () => {
    const { service, bookingService } = serviceWith(order());
    await expect(
      service.verifyAndBook(
        CUSTOMER.toString(),
        dto({ razorpaySignature: sign('order_ABC', 'pay_SOMEONE_ELSE') }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(bookingService.createFromQuotation).not.toHaveBeenCalled();
  });

  it("will not let one customer settle another's payment", async () => {
    const { service, bookingService } = serviceWith(order());
    await expect(
      service.verifyAndBook(new Types.ObjectId().toString(), dto()),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(bookingService.createFromQuotation).not.toHaveBeenCalled();
  });

  it('books under the customer who paid, not whoever called', async () => {
    const { service, bookingService } = serviceWith(order());
    await service.verifyAndBook(CUSTOMER.toString(), dto());
    expect(bookingService.createFromQuotation.mock.calls[0][0]).toBe(CUSTOMER.toString());
  });

  it('carries the coupon that was priced into the order', async () => {
    // Re-read from the order, never from the request, so a coupon cannot be
    // swapped between paying and booking.
    const { service, bookingService } = serviceWith(order({ couponCode: 'FESTIVE10' }));
    await service.verifyAndBook(CUSTOMER.toString(), dto());
    expect(bookingService.createFromQuotation.mock.calls[0][1]).toEqual({
      quotationId: QUOTATION.toString(),
      couponCode: 'FESTIVE10',
    });
  });
});

describe('the webhook', () => {
  const body = (event: string) =>
    JSON.stringify({
      event,
      payload: { payment: { entity: { id: 'pay_XYZ', order_id: 'order_ABC' } } },
    });
  const hook = (raw: string) => createHmac('sha256', WEBHOOK_SECRET).update(raw).digest('hex');

  it('settles a captured payment even if the app never came back', async () => {
    // A customer whose phone died between paying and confirming still gets
    // their booking, because this arrives regardless of the app.
    const raw = body('payment.captured');
    const { service, bookingService } = serviceWith(order());

    await expect(service.handleWebhook(raw, hook(raw))).resolves.toEqual({ handled: true });
    expect(bookingService.createFromQuotation).toHaveBeenCalledTimes(1);
  });

  it('refuses a body that is not signed with the webhook secret', async () => {
    const raw = body('payment.captured');
    const { service, bookingService } = serviceWith(order());

    // Signed with the API secret rather than the webhook's — a real mix-up,
    // and it must not be accepted.
    const wrong = createHmac('sha256', KEY_SECRET).update(raw).digest('hex');
    await expect(service.handleWebhook(raw, wrong)).rejects.toBeInstanceOf(BadRequestException);
    expect(bookingService.createFromQuotation).not.toHaveBeenCalled();
  });

  it('records a failure without booking anything', async () => {
    const raw = body('payment.failed');
    const row = order();
    const { service, bookingService } = serviceWith(row);

    await expect(service.handleWebhook(raw, hook(raw))).resolves.toEqual({ handled: true });
    expect(row.status).toBe(PaymentOrderStatus.FAILED);
    expect(bookingService.createFromQuotation).not.toHaveBeenCalled();
  });

  it('ignores an event for an order it has never heard of', async () => {
    const raw = body('payment.captured');
    const { service } = serviceWith(null);
    await expect(service.handleWebhook(raw, hook(raw))).resolves.toEqual({ handled: false });
  });
});

describe('settling twice', () => {
  it('claims the order in one write, so a race cannot book twice', async () => {
    const row = order();
    const { service, orderModel } = serviceWith(row);

    await service.verifyAndBook(CUSTOMER.toString(), {
      razorpayOrderId: 'order_ABC',
      razorpayPaymentId: 'pay_XYZ',
      razorpaySignature: sign('order_ABC', 'pay_XYZ'),
    });

    const [filter, update] = orderModel.findOneAndUpdate.mock.calls[0];
    // The filter asserts it has not been settled yet; the update settles it.
    expect(filter.status).toBe(PaymentOrderStatus.CREATED);
    expect(update.status).toBe(PaymentOrderStatus.PAID);
    expect(update.razorpayPaymentId).toBe('pay_XYZ');
  });

  it('still returns the booking when the other caller won the claim', async () => {
    // Booking creation is idempotent per quotation, so the loser of the race
    // gets the same booking back rather than an error.
    const { service, orderModel, bookingService } = serviceWith(order());
    orderModel.findOneAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });

    await expect(
      service.verifyAndBook(CUSTOMER.toString(), {
        razorpayOrderId: 'order_ABC',
        razorpayPaymentId: 'pay_XYZ',
        razorpaySignature: sign('order_ABC', 'pay_XYZ'),
      }),
    ).resolves.toEqual({ id: 'bk1' });
    expect(bookingService.createFromQuotation).toHaveBeenCalledTimes(1);
  });
});
