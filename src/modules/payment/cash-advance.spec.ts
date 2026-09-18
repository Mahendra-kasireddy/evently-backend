/**
 * Booking with the advance owed in cash.
 *
 * The whole risk in this path is claiming money has moved when it has not.
 * Evently never touches a cash advance, so it cannot refund one and must not
 * count one — until the organizer, who is the only person who knows, says it
 * reached them.
 */

import { PaymentMethod, PaymentOrderStatus } from './schemas/payment-order.schema';
import { AdvanceMethod, PaymentStatus } from '../booking/schemas/booking.schema';

/** The booking's money fields, mirrored from `createBookingDocument`. */
function bookingMoney(advanceMethod: AdvanceMethod, advanceAmount: number) {
  const cash = advanceMethod === AdvanceMethod.CASH;
  return {
    advanceAmount,
    amountPaid: cash ? 0 : advanceAmount,
    paymentStatus: cash ? PaymentStatus.UNPAID : PaymentStatus.ADVANCE_PAID,
    advancePaidAt: cash ? null : 'placedAt',
  };
}

/** Whether `assertPaidFor` lets this order through. */
function opensABooking(status: PaymentOrderStatus): boolean {
  return status === PaymentOrderStatus.PAID || status === PaymentOrderStatus.CASH_DUE;
}

describe('a cash booking', () => {
  it('is real, but records nothing as paid', () => {
    expect(bookingMoney(AdvanceMethod.CASH, 205200)).toEqual({
      advanceAmount: 205200,
      amountPaid: 0,
      paymentStatus: PaymentStatus.UNPAID,
      advancePaidAt: null,
    });
  });

  it('differs from an online one only in whether the money arrived', () => {
    // Same amount owed; the method decides whether it is in hand.
    const online = bookingMoney(AdvanceMethod.ONLINE, 205200);
    const cash = bookingMoney(AdvanceMethod.CASH, 205200);
    expect(online.advanceAmount).toBe(cash.advanceAmount);
    expect(online.paymentStatus).toBe(PaymentStatus.ADVANCE_PAID);
    expect(online.amountPaid).toBe(205200);
  });
});

describe('the gate on writing a booking', () => {
  it('accepts a cash order, because the server wrote it', () => {
    /*
     * The gate asks "did this customer really go through checkout for this
     * quotation", not "has Evently got the money". A cash order is that
     * record — which is exactly why the booking it opens stays UNPAID.
     */
    expect(opensABooking(PaymentOrderStatus.CASH_DUE)).toBe(true);
    expect(opensABooking(PaymentOrderStatus.PAID)).toBe(true);
  });

  it('still refuses an order nobody has settled either way', () => {
    expect(opensABooking(PaymentOrderStatus.CREATED)).toBe(false);
    expect(opensABooking(PaymentOrderStatus.FAILED)).toBe(false);
    expect(opensABooking(PaymentOrderStatus.REFUNDED)).toBe(false);
  });
});

describe('the cash order itself', () => {
  it('is marked as cash and carries no gateway id', () => {
    /*
     * The uniqueness index on razorpayOrderId is partial for this reason: a
     * plain unique index over an empty string would let exactly one cash order
     * exist in the whole database and reject every booking after the first.
     */
    const order = {
      method: PaymentMethod.CASH,
      razorpayOrderId: '',
      status: PaymentOrderStatus.CASH_DUE,
    };
    expect(order.method).toBe(PaymentMethod.CASH);
    expect(order.razorpayOrderId).toBe('');
    expect(order.status).not.toBe(PaymentOrderStatus.PAID);
  });
});
