import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { CouponService } from './coupon.service';
import { CouponDiscountType, CouponScope, CouponStatus } from './schemas/coupon.schema';
import { RedemptionStatus } from './schemas/coupon-redemption.schema';

/**
 * The coupon rules.
 *
 * These are the tests worth having: what a coupon is worth, and every reason it
 * can be refused. Both answers come from one place — `evaluate` is what the
 * picker, the preview and the booking write all call — so testing it here tests
 * all three, and a rule that is wrong is wrong everywhere at once rather than
 * in one surface that the others disagree with.
 */

const ORGANIZER = new Types.ObjectId();
const OTHER_ORGANIZER = new Types.ObjectId();
const NOW = Date.now();
const HOUR = 60 * 60 * 1000;

type CouponLike = Record<string, unknown>;

/** A coupon that would be accepted, so each test can break exactly one thing. */
const coupon = (over: CouponLike = {}): CouponLike => ({
  _id: new Types.ObjectId(),
  code: 'SAVE20',
  title: '20% off',
  description: '',
  scope: CouponScope.PLATFORM,
  organizer: null,
  discountType: CouponDiscountType.PERCENTAGE,
  discountValue: 20,
  maxDiscount: 0,
  minBookingAmount: 0,
  startsAt: null,
  endsAt: null,
  usageLimit: 0,
  perCustomerLimit: 1,
  usedCount: 0,
  status: CouponStatus.ACTIVE,
  ...over,
});

/** Typed so a test can null the organizer out — a booking may have none. */
const CONTEXT: { customerId: string; organizerId: string | null; amount: number } = {
  customerId: new Types.ObjectId().toString(),
  organizerId: ORGANIZER.toString(),
  amount: 100_000,
};

/**
 * A service wired to stub models.
 *
 * Only the two collections are stubbed. Nothing about the rules lives in Mongo,
 * so a test that had to stand a database up would be testing Mongo.
 */
function serviceWith(found: CouponLike | null, customerUses = 0, overrides: CouponLike = {}) {
  const couponModel = {
    findOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(found) }),
    findOneAndUpdate: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(found) }),
    ...overrides,
  };
  const redemptionModel = {
    countDocuments: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(customerUses) }),
    create: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }),
    findOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }),
  };

  const service = new CouponService(
    couponModel as never,
    redemptionModel as never,
    {} as never,
    {} as never,
  );
  return { service, couponModel, redemptionModel };
}

const refusal = async (found: CouponLike, uses = 0, context = CONTEXT): Promise<string> => {
  const { service } = serviceWith(found, uses);
  try {
    await service.evaluate(context, 'SAVE20');
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    return (error as BadRequestException).message;
  }
  throw new Error('expected the coupon to be refused');
};

describe('discountFor', () => {
  it('takes a percentage of the booking', () => {
    expect(
      CouponService.discountFor(
        { discountType: CouponDiscountType.PERCENTAGE, discountValue: 20, maxDiscount: 0 },
        100_000,
      ),
    ).toBe(20_000);
  });

  it('honours the cap, which is the point of having one', () => {
    // 20% of a ₹6L wedding is ₹1.2L, which is not what "20% off" means.
    expect(
      CouponService.discountFor(
        { discountType: CouponDiscountType.PERCENTAGE, discountValue: 20, maxDiscount: 5_000 },
        600_000,
      ),
    ).toBe(5_000);
  });

  it('ignores the cap for a fixed discount, where it means nothing', () => {
    expect(
      CouponService.discountFor(
        { discountType: CouponDiscountType.FIXED, discountValue: 8_000, maxDiscount: 5_000 },
        100_000,
      ),
    ).toBe(8_000);
  });

  it('floors rather than rounds, so it never exceeds what it advertises', () => {
    // 7.5% of 1,999 is 149.925 — paying out 150 would be 7.503%.
    expect(
      CouponService.discountFor(
        { discountType: CouponDiscountType.PERCENTAGE, discountValue: 15, maxDiscount: 0 },
        1_999,
      ),
    ).toBe(299);
  });

  it('never discounts more than the booking is worth', () => {
    // The marketplace has no refund rail; a customer owed money is a bug.
    expect(
      CouponService.discountFor(
        { discountType: CouponDiscountType.FIXED, discountValue: 50_000, maxDiscount: 0 },
        20_000,
      ),
    ).toBe(20_000);
  });

  it('takes nothing off a booking worth nothing', () => {
    expect(
      CouponService.discountFor(
        { discountType: CouponDiscountType.PERCENTAGE, discountValue: 20, maxDiscount: 0 },
        0,
      ),
    ).toBe(0);
  });
});

describe('evaluate', () => {
  it('prices a valid coupon against the amount the server read', async () => {
    const { service } = serviceWith(coupon());
    const quote = await service.evaluate(CONTEXT, 'save20');

    expect(quote.originalAmount).toBe(100_000);
    expect(quote.discountAmount).toBe(20_000);
    expect(quote.finalAmount).toBe(80_000);
    expect(quote.code).toBe('SAVE20');
  });

  it('matches the code case- and space-insensitively', async () => {
    const { service, couponModel } = serviceWith(coupon());
    await service.evaluate(CONTEXT, '  save20 ');
    expect(couponModel.findOne).toHaveBeenCalledWith({ code: 'SAVE20' });
  });

  it('refuses a code that does not exist', async () => {
    const { service } = serviceWith(null);
    await expect(service.evaluate(CONTEXT, 'NOPE99')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a disabled coupon', async () => {
    expect(await refusal(coupon({ status: CouponStatus.DISABLED }))).toContain('no longer');
  });

  it('refuses one that has not started, and says when it does', async () => {
    const message = await refusal(coupon({ startsAt: new Date(NOW + 48 * HOUR) }));
    expect(message).toContain('can be used from');
  });

  it('refuses an expired coupon', async () => {
    expect(await refusal(coupon({ endsAt: new Date(NOW - HOUR) }))).toContain('expired');
  });

  it("refuses another organizer's coupon", async () => {
    const message = await refusal(
      coupon({ scope: CouponScope.ORGANIZER, organizer: OTHER_ORGANIZER }),
    );
    expect(message).toContain('organizer who issued it');
  });

  it("accepts the issuing organizer's own coupon", async () => {
    const { service } = serviceWith(coupon({ scope: CouponScope.ORGANIZER, organizer: ORGANIZER }));
    await expect(service.evaluate(CONTEXT, 'SAVE20')).resolves.toMatchObject({
      discountAmount: 20_000,
    });
  });

  it('refuses an organizer coupon on a booking with no organizer', async () => {
    const message = await refusal(
      coupon({ scope: CouponScope.ORGANIZER, organizer: ORGANIZER }),
      0,
      {
        ...CONTEXT,
        organizerId: null,
      },
    );
    expect(message).toContain('organizer who issued it');
  });

  it('refuses a basket under the minimum, and names the minimum', async () => {
    const message = await refusal(coupon({ minBookingAmount: 250_000 }));
    expect(message).toContain('2,50,000');
  });

  it('refuses a coupon that has been fully claimed', async () => {
    expect(await refusal(coupon({ usageLimit: 100, usedCount: 100 }))).toContain('fully claimed');
  });

  it('allows one more while a slot remains', async () => {
    const { service } = serviceWith(coupon({ usageLimit: 100, usedCount: 99 }));
    await expect(service.evaluate(CONTEXT, 'SAVE20')).resolves.toBeDefined();
  });

  it('refuses a customer who has already used it', async () => {
    expect(await refusal(coupon({ perCustomerLimit: 1 }), 1)).toContain('already used');
  });

  it('treats a zero per-customer limit as unlimited, not as none', async () => {
    const { service } = serviceWith(coupon({ perCustomerLimit: 0 }), 12);
    await expect(service.evaluate(CONTEXT, 'SAVE20')).resolves.toBeDefined();
  });

  it('refuses a coupon that would take nothing off', async () => {
    // ₹0 off is not an offer, and a "₹0 saved" row on the bill is worse.
    const message = await refusal(
      coupon({ discountType: CouponDiscountType.PERCENTAGE, discountValue: 1 }),
      0,
      { ...CONTEXT, amount: 50 },
    );
    expect(message).toContain('nothing off');
  });
});

describe('redeem', () => {
  const quote = {
    couponId: new Types.ObjectId().toString(),
    code: 'SAVE20',
    title: '20% off',
    description: '',
    discountType: CouponDiscountType.PERCENTAGE,
    discountValue: 20,
    originalAmount: 100_000,
    discountAmount: 20_000,
    finalAmount: 80_000,
  };
  const params = {
    quote,
    customerId: new Types.ObjectId().toString(),
    bookingId: new Types.ObjectId().toString(),
    organizerId: ORGANIZER.toString(),
  };

  it('claims the slot in the same write that finds the coupon', async () => {
    // This is the whole concurrency story: the filter asserts a slot is free
    // and the $inc takes it, atomically, on one document.
    const { service, couponModel } = serviceWith(coupon());
    await service.redeem(params);

    const [filter, update] = couponModel.findOneAndUpdate.mock.calls[0];
    expect(update).toEqual({ $inc: { usedCount: 1 } });
    expect(JSON.stringify(filter)).toContain('$lt');
    expect(filter.status).toBe(CouponStatus.ACTIVE);
  });

  it('writes the ledger row with the money as charged', async () => {
    const { service, redemptionModel } = serviceWith(coupon());
    await service.redeem(params);

    expect(redemptionModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'SAVE20',
        originalAmount: 100_000,
        discountAmount: 20_000,
        finalAmount: 80_000,
        status: RedemptionStatus.REDEEMED,
      }),
    );
  });

  it('refuses when the last slot went to somebody else', async () => {
    // The conditional update matched nothing — another checkout won the race.
    const { service } = serviceWith(null);
    await expect(service.redeem(params)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('hands the slot back and returns the existing row on a retry', async () => {
    const existing = { _id: new Types.ObjectId() };
    const { service, couponModel, redemptionModel } = serviceWith(coupon());
    redemptionModel.create.mockRejectedValueOnce({ code: 11000 });
    redemptionModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(existing) });

    await expect(service.redeem(params)).resolves.toBe(existing);

    // Second call to findOneAndUpdate is the release — the counter must not
    // drift above the ledger just because a write was retried.
    const release = couponModel.findOneAndUpdate.mock.calls[1];
    expect(release[1]).toEqual({ $inc: { usedCount: -1 } });
  });

  it('hands the slot back when the ledger write fails outright', async () => {
    const { service, couponModel, redemptionModel } = serviceWith(coupon());
    redemptionModel.create.mockRejectedValueOnce(new Error('disk on fire'));

    await expect(service.redeem(params)).rejects.toThrow('disk on fire');
    expect(couponModel.findOneAndUpdate.mock.calls[1][1]).toEqual({ $inc: { usedCount: -1 } });
  });
});
