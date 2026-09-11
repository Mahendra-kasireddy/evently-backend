import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Role } from '../../common/enums/role.enum';
import { PaginatedResult } from '../../common/dto/pagination.dto';
import { OrganizerService } from '../organizer/organizer.service';
import { QuoteService } from '../quote/quote.service';
import {
  Coupon,
  CouponDiscountType,
  CouponDocument,
  CouponScope,
  CouponStatus,
} from './schemas/coupon.schema';
import {
  CouponRedemption,
  CouponRedemptionDocument,
  RedemptionStatus,
} from './schemas/coupon-redemption.schema';
import { CouponTermsDto } from './dto/coupon-terms.dto';
import { UpdateCouponDto } from './dto/update-coupon.dto';
import { ListCouponsDto } from './dto/list-coupons.dto';

/** A coupon as any management screen lists it. */
export interface CouponView {
  id: string;
  code: string;
  title: string;
  description: string;
  scope: CouponScope;
  organizerId: string | null;
  organizerName: string;
  discountType: CouponDiscountType;
  discountValue: number;
  maxDiscount: number;
  minBookingAmount: number;
  startsAt: string | null;
  endsAt: string | null;
  usageLimit: number;
  perCustomerLimit: number;
  usedCount: number;
  status: CouponStatus;
  createdByRole: Role;
  createdAt: string | null;
}

/**
 * What a coupon is worth on one specific booking.
 *
 * Every number a customer is ever shown comes from here, computed on the
 * server from the quotation's own total. The client is never asked what the
 * booking costs and never told to work out the discount itself.
 */
export interface CouponQuote {
  couponId: string;
  code: string;
  title: string;
  description: string;
  discountType: CouponDiscountType;
  discountValue: number;
  originalAmount: number;
  discountAmount: number;
  finalAmount: number;
}

/** A coupon offered in the picker, already priced against this booking. */
export interface EligibleCoupon extends CouponQuote {
  scope: CouponScope;
  minBookingAmount: number;
  endsAt: string | null;
}

/**
 * A coupon advertised to a customer who is not at a checkout.
 *
 * Deliberately not priced. Away from a booking there is no total to take a
 * percentage of and no organizer to match, so this carries the coupon's terms
 * — the discount, the minimum, the window — and lets the customer read them,
 * rather than a saving figure it would have to invent.
 */
export interface ClaimableCoupon {
  id: string;
  code: string;
  title: string;
  /**
   * The organizer whose coupon this is, or '' for a platform-wide one.
   *
   * Named rather than merely scoped, because a card that says "with Mahendra
   * Events" cannot mislead: the customer sees exactly where the code works
   * before they act on it.
   */
  organizerName: string;
  description: string;
  discountType: CouponDiscountType;
  discountValue: number;
  maxDiscount: number;
  minBookingAmount: number;
  endsAt: string | null;
  perCustomerLimit: number;
  /** How many times this customer has already spent it. */
  timesUsed: number;
}

/** One line of the redemption ledger, for the admin and organizer screens. */
export interface RedemptionView {
  id: string;
  code: string;
  customerName: string;
  bookingRef: string;
  organizerName: string;
  originalAmount: number;
  discountAmount: number;
  finalAmount: number;
  status: RedemptionStatus;
  redeemedAt: string | null;
}

/**
 * The booking a coupon is being judged against.
 *
 * Always derived on the server from the quotation — never assembled from
 * anything the client sent.
 */
interface BookingContext {
  customerId: string;
  organizerId: string | null;
  amount: number;
}

/** Populated shapes the ledger reads through. */
interface NamedRef {
  _id?: Types.ObjectId;
  name?: string;
}
interface BookingRef {
  _id?: Types.ObjectId;
  ref?: string;
}

/**
 * How many coupons the home carousel is ever sent.
 *
 * A promo strip is read, not scrolled through — past a handful the extra cards
 * are cost with no reader.
 */
const CLAIMABLE_LIMIT = 8;

/**
 * How many are read before the per-customer limit thins them out. Wider than
 * the strip, so a customer who has already used a few still sees a full one.
 */
const CLAIMABLE_CANDIDATES = 40;

/**
 * The populated organizer's name, or '' for a platform coupon.
 *
 * Read defensively rather than cast: an organizer document that was deleted
 * leaves its reference behind, and a card headed "undefined" is worse than one
 * that simply names nobody.
 */
function organizerNameOf(coupon: CouponDocument): string {
  const organizer = coupon.organizer as unknown as { name?: string } | null;
  return organizer && typeof organizer === 'object' && typeof organizer.name === 'string'
    ? organizer.name
    : '';
}

/** Sort key: a real deadline by its time, no deadline at the very end. */
function endsFirst(endsAt: Date | null): number {
  return endsAt ? endsAt.getTime() : Number.MAX_SAFE_INTEGER;
}

@Injectable()
export class CouponService {
  constructor(
    @InjectModel(Coupon.name) private readonly couponModel: Model<CouponDocument>,
    @InjectModel(CouponRedemption.name)
    private readonly redemptionModel: Model<CouponRedemptionDocument>,
    private readonly quoteService: QuoteService,
    private readonly organizerService: OrganizerService,
  ) {}

  // -------------------------------------------------------------------------
  // Calculation — the only place a discount is ever worked out
  // -------------------------------------------------------------------------

  /**
   * What this coupon takes off this amount.
   *
   * Floored rather than rounded, so a coupon never gives away more than the
   * percentage it advertises, and clamped to the booking total so a fixed
   * coupon larger than the bill leaves the customer paying zero rather than
   * being owed money by a marketplace with no refund rail.
   */
  static discountFor(
    coupon: Pick<Coupon, 'discountType' | 'discountValue' | 'maxDiscount'>,
    amount: number,
  ): number {
    if (amount <= 0) return 0;

    const raw =
      coupon.discountType === CouponDiscountType.PERCENTAGE
        ? Math.floor((amount * coupon.discountValue) / 100)
        : coupon.discountValue;

    const capped =
      coupon.discountType === CouponDiscountType.PERCENTAGE && coupon.maxDiscount > 0
        ? Math.min(raw, coupon.maxDiscount)
        : raw;

    return Math.max(0, Math.min(Math.floor(capped), amount));
  }

  /**
   * Why this coupon cannot be used here — or null if it can.
   *
   * One function, called by the picker, by the preview, and again by the
   * booking write. Three callers, one set of rules: a coupon that the list
   * offered cannot turn out to be refused at checkout for a reason the list
   * did not know about, and a code applied at checkout is re-judged by exactly
   * the same code path before any money is settled.
   *
   * The reasons are written to be shown to the customer, because "invalid
   * coupon" leaves somebody staring at a code that worked yesterday.
   */
  private reasonAgainst(
    coupon: CouponDocument,
    context: BookingContext,
    customerUses: number,
    now: Date,
  ): string | null {
    if (coupon.status !== CouponStatus.ACTIVE) {
      return 'This coupon is no longer available.';
    }
    if (coupon.startsAt && coupon.startsAt.getTime() > now.getTime()) {
      const on = coupon.startsAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
      return `This coupon can be used from ${on}.`;
    }
    if (coupon.endsAt && coupon.endsAt.getTime() < now.getTime()) {
      return 'This coupon has expired.';
    }
    if (coupon.scope === CouponScope.ORGANIZER) {
      const owner = coupon.organizer?.toString() ?? '';
      if (!context.organizerId || owner !== context.organizerId) {
        return 'This coupon only works with the organizer who issued it.';
      }
    }
    if (coupon.minBookingAmount > 0 && context.amount < coupon.minBookingAmount) {
      const min = coupon.minBookingAmount.toLocaleString('en-IN');
      return `This coupon needs a booking of ₹${min} or more.`;
    }
    if (coupon.usageLimit > 0 && coupon.usedCount >= coupon.usageLimit) {
      return 'This coupon has been fully claimed.';
    }
    if (coupon.perCustomerLimit > 0 && customerUses >= coupon.perCustomerLimit) {
      return coupon.perCustomerLimit === 1
        ? 'You have already used this coupon.'
        : 'You have used this coupon as many times as it allows.';
    }
    if (CouponService.discountFor(coupon, context.amount) <= 0) {
      return 'This coupon takes nothing off this booking.';
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Customer surface
  // -------------------------------------------------------------------------

  /**
   * The coupons this customer could actually use on this quotation.
   *
   * Only usable ones come back. An expired, disabled, exhausted, already-used
   * or too-small-basket coupon is not shown greyed out with an explanation —
   * a list of things you cannot have is not a list of offers.
   */
  async listAvailable(userId: string, quotationId: string): Promise<EligibleCoupon[]> {
    const context = await this.contextFor(userId, quotationId);
    const now = new Date();

    const candidates = await this.couponModel
      .find({
        status: CouponStatus.ACTIVE,
        $and: [
          { $or: [{ startsAt: null }, { startsAt: { $lte: now } }] },
          { $or: [{ endsAt: null }, { endsAt: { $gte: now } }] },
          {
            $or: [
              { scope: CouponScope.PLATFORM },
              ...(context.organizerId
                ? [
                    {
                      scope: CouponScope.ORGANIZER,
                      organizer: new Types.ObjectId(context.organizerId),
                    },
                  ]
                : []),
            ],
          },
        ],
      })
      .exec();

    if (candidates.length === 0) return [];

    const uses = await this.usesByCoupon(
      context.customerId,
      candidates.map((c) => c._id),
    );

    return (
      candidates
        .filter(
          (coupon) =>
            this.reasonAgainst(coupon, context, uses.get(coupon._id.toString()) ?? 0, now) === null,
        )
        .map((coupon) => ({
          ...this.quoteFor(coupon, context.amount),
          scope: coupon.scope,
          minBookingAmount: coupon.minBookingAmount,
          endsAt: coupon.endsAt ? coupon.endsAt.toISOString() : null,
        }))
        /* Best first — the customer should not have to compare them by hand. */
        .sort((a, b) => b.discountAmount - a.discountAmount)
    );
  }

  /**
   * The coupons worth telling this customer about, with no booking in hand.
   *
   * Platform coupons, plus the coupons of organizers this customer is already
   * dealing with — anyone who has a live quotation out to them. An organizer's
   * coupon is worth nothing unless that organizer is booked, so advertising
   * every organizer's codes would fill the strip with offers the customer
   * cannot use; restricting it to organizers already in the conversation makes
   * it the opposite — a discount available on a quote they are weighing up
   * right now. Either way the card carries the organizer's name, so it can
   * never imply a code works more widely than it does.
   *
   * The checks that can be made without a booking are made: live, in window,
   * slots left, and this customer has not already used it up. The one that
   * cannot — the minimum spend — is stated on the card instead of being
   * silently assumed, which is why `minBookingAmount` is part of the view
   * rather than a filter.
   */
  async listClaimable(userId: string): Promise<ClaimableCoupon[]> {
    if (!Types.ObjectId.isValid(userId)) return [];
    const now = new Date();

    // Whose organizer coupons are relevant here: anyone with a live quote out
    // to this customer. See QuoteService.organizerIdsForCustomer.
    const engaged = await this.quoteService.organizerIdsForCustomer(userId);

    const rows = await this.couponModel
      .find({
        status: CouponStatus.ACTIVE,
        $and: [
          { $or: [{ startsAt: null }, { startsAt: { $lte: now } }] },
          { $or: [{ endsAt: null }, { endsAt: { $gte: now } }] },
          { $or: [{ usageLimit: 0 }, { $expr: { $lt: ['$usedCount', '$usageLimit'] } }] },
          {
            $or: [
              { scope: CouponScope.PLATFORM },
              ...(engaged.length > 0
                ? [
                    {
                      scope: CouponScope.ORGANIZER,
                      organizer: { $in: engaged.map((id) => new Types.ObjectId(id)) },
                    },
                  ]
                : []),
            ],
          },
        ],
      })
      .populate('organizer', 'name')
      /* Bounded, but not yet cut to the strip's size: the per-customer limit
         below can still remove rows, and slicing before that could drop a
         coupon the customer can use in favour of one they cannot. */
      .limit(CLAIMABLE_CANDIDATES)
      .exec();

    if (rows.length === 0) return [];

    const uses = await this.usesByCoupon(
      userId,
      rows.map((row) => row._id),
    );

    return (
      rows
        .map((row) => ({ row, timesUsed: uses.get(row._id.toString()) ?? 0 }))
        .filter(
          ({ row, timesUsed }) => row.perCustomerLimit === 0 || timesUsed < row.perCustomerLimit,
        )
        /*
         * Soonest to expire first, open-ended last.
         *
         * Sorted here rather than in the query because Mongo orders a null
         * `endsAt` *before* every real date ascending — which would have put the
         * coupons in no hurry at the front of a strip meant to lead with the one
         * about to run out.
         */
        .sort((a, b) => endsFirst(a.row.endsAt) - endsFirst(b.row.endsAt))
        .slice(0, CLAIMABLE_LIMIT)
        .map(({ row, timesUsed }) => ({
          id: row._id.toString(),
          code: row.code,
          title: row.title,
          organizerName: organizerNameOf(row),
          description: row.description ?? '',
          discountType: row.discountType,
          discountValue: row.discountValue,
          maxDiscount: row.maxDiscount,
          minBookingAmount: row.minBookingAmount,
          endsAt: row.endsAt ? row.endsAt.toISOString() : null,
          perCustomerLimit: row.perCustomerLimit,
          timesUsed,
        }))
    );
  }

  /**
   * What a typed code is worth here, or why it is refused.
   *
   * The refusal is a 400 with the reason in the message, because the customer
   * typed something and is owed an answer about it.
   */
  async preview(userId: string, quotationId: string, code: string): Promise<CouponQuote> {
    const context = await this.contextFor(userId, quotationId);
    return this.evaluate(context, code);
  }

  /**
   * The gate every redemption goes through.
   *
   * Public so the booking write can call it with a context it derived itself,
   * rather than re-deriving the quotation a second time.
   */
  async evaluate(context: BookingContext, code: string): Promise<CouponQuote> {
    const coupon = await this.couponModel.findOne({ code: normalizeCode(code) }).exec();
    if (!coupon) throw new BadRequestException('We could not find that coupon code.');

    const customerUses = await this.redemptionModel
      .countDocuments({
        coupon: coupon._id,
        customer: new Types.ObjectId(context.customerId),
        status: RedemptionStatus.REDEEMED,
      })
      .exec();

    const reason = this.reasonAgainst(coupon, context, customerUses, new Date());
    if (reason) throw new BadRequestException(reason);

    return this.quoteFor(coupon, context.amount);
  }

  /** The booking facts a coupon is judged against, read from the quotation. */
  async contextFor(userId: string, quotationId: string): Promise<BookingContext> {
    const seed = await this.quoteService.getBookingSeed(userId, quotationId);
    return {
      customerId: seed.customerId,
      organizerId: seed.organizerId,
      amount: seed.amount,
    };
  }

  // -------------------------------------------------------------------------
  // Redemption
  // -------------------------------------------------------------------------

  /**
   * Spend the coupon, once, against a booking that already exists.
   *
   * The usage limit is claimed by a single conditional update: the same filter
   * that finds the coupon also asserts there is a slot left, and Mongo applies
   * the `$inc` to one document atomically. Two simultaneous checkouts for the
   * last slot therefore cannot both win — one of them matches nothing and is
   * told the coupon is gone. That is a stronger guarantee than wrapping a
   * read-then-write in a transaction, which would still let both read the same
   * count.
   *
   * The ledger row is written second, under a unique index on
   * `{ coupon, booking }`. If it collides the coupon was already spent on this
   * booking — a retry, not a second use — so the claim is handed back and the
   * existing row returned. Any other failure hands the claim back too, so a
   * counter can never drift upwards past the ledger.
   */
  async redeem(params: {
    quote: CouponQuote;
    customerId: string;
    bookingId: string;
    organizerId: string | null;
  }): Promise<CouponRedemptionDocument> {
    const { quote, customerId, bookingId, organizerId } = params;
    const now = new Date();
    const couponId = new Types.ObjectId(quote.couponId);

    const claimed = await this.couponModel
      .findOneAndUpdate(
        {
          _id: couponId,
          status: CouponStatus.ACTIVE,
          $and: [
            { $or: [{ startsAt: null }, { startsAt: { $lte: now } }] },
            { $or: [{ endsAt: null }, { endsAt: { $gte: now } }] },
            {
              $or: [{ usageLimit: 0 }, { $expr: { $lt: ['$usedCount', '$usageLimit'] } }],
            },
          ],
        },
        { $inc: { usedCount: 1 } },
        { new: true },
      )
      .exec();

    if (!claimed) throw new BadRequestException('This coupon is no longer available.');

    try {
      return await this.redemptionModel.create({
        coupon: couponId,
        code: quote.code,
        customer: new Types.ObjectId(customerId),
        booking: new Types.ObjectId(bookingId),
        organizer: organizerId ? new Types.ObjectId(organizerId) : null,
        originalAmount: quote.originalAmount,
        discountAmount: quote.discountAmount,
        finalAmount: quote.finalAmount,
        status: RedemptionStatus.REDEEMED,
        redeemedAt: now,
      });
    } catch (error) {
      await this.releaseClaim(couponId);

      if (isDuplicateKey(error)) {
        const existing = await this.redemptionModel
          .findOne({ coupon: couponId, booking: new Types.ObjectId(bookingId) })
          .exec();
        if (existing) return existing;
      }
      throw error;
    }
  }

  /**
   * Give the coupon back when the booking it paid for did not survive.
   *
   * A booking that the organizer declined, let expire, or that was cancelled
   * never became an event, and burning the customer's one-per-person coupon on
   * it would be taking something for nothing. Best-effort and idempotent: only
   * rows still marked redeemed are reversed, so calling it twice on the same
   * booking returns the slot once.
   */
  async releaseForBooking(bookingId: string): Promise<void> {
    if (!Types.ObjectId.isValid(bookingId)) return;

    const rows = await this.redemptionModel
      .find({ booking: new Types.ObjectId(bookingId), status: RedemptionStatus.REDEEMED })
      .exec();

    for (const row of rows) {
      const reversed = await this.redemptionModel
        .findOneAndUpdate(
          { _id: row._id, status: RedemptionStatus.REDEEMED },
          { status: RedemptionStatus.REVERSED, reversedAt: new Date() },
        )
        .exec();
      // Only the call that actually flipped it gives the slot back.
      if (reversed) await this.releaseClaim(row.coupon);
    }
  }

  // -------------------------------------------------------------------------
  // Organizer surface — always scoped to the caller's own profile
  // -------------------------------------------------------------------------

  async createForOrganizer(userId: string, dto: CouponTermsDto): Promise<CouponView> {
    const profile = await this.requireOrganizer(userId);
    return this.create(dto, {
      scope: CouponScope.ORGANIZER,
      organizer: profile._id,
      createdBy: new Types.ObjectId(userId),
      createdByRole: Role.ORGANIZER,
    });
  }

  async listForOrganizer(userId: string): Promise<CouponView[]> {
    const profile = await this.requireOrganizer(userId);
    const rows = await this.couponModel
      .find({ scope: CouponScope.ORGANIZER, organizer: profile._id })
      .sort({ createdAt: -1 })
      .exec();
    return rows.map((row) => this.toView(row, profile.name));
  }

  async updateForOrganizer(
    userId: string,
    couponId: string,
    dto: UpdateCouponDto,
  ): Promise<CouponView> {
    const coupon = await this.requireOwnCoupon(userId, couponId);
    applyTerms(coupon, dto);
    await coupon.save();
    return this.toView(coupon);
  }

  async setStatusForOrganizer(
    userId: string,
    couponId: string,
    status: CouponStatus,
  ): Promise<CouponView> {
    const coupon = await this.requireOwnCoupon(userId, couponId);
    coupon.status = status;
    await coupon.save();
    return this.toView(coupon);
  }

  /** Every redemption of this organizer's own coupons. */
  async usageForOrganizer(userId: string): Promise<RedemptionView[]> {
    const profile = await this.requireOrganizer(userId);
    return this.ledger({ organizer: profile._id });
  }

  // -------------------------------------------------------------------------
  // Admin surface
  // -------------------------------------------------------------------------

  /** Admins issue platform coupons. Organizer coupons are the organizer's. */
  async createPlatform(userId: string, dto: CouponTermsDto): Promise<CouponView> {
    return this.create(dto, {
      scope: CouponScope.PLATFORM,
      organizer: null,
      createdBy: new Types.ObjectId(userId),
      createdByRole: Role.ADMIN,
    });
  }

  async adminList(query: ListCouponsDto): Promise<PaginatedResult<CouponView>> {
    const filter: Record<string, unknown> = {};
    if (query.scope) filter.scope = query.scope;
    if (query.status) filter.status = query.status;

    const search = (query.search ?? '').trim();
    if (search) {
      const term = new RegExp(escapeRegex(search), 'i');
      filter.$or = [{ code: term }, { title: term }];
    }

    const [rows, total] = await Promise.all([
      this.couponModel
        .find(filter)
        .populate('organizer', 'name')
        .sort({ createdAt: -1 })
        .skip(query.skip)
        .limit(query.limit)
        .exec(),
      this.couponModel.countDocuments(filter).exec(),
    ]);

    return {
      data: rows.map((row) => this.toView(row)),
      meta: {
        total,
        page: query.page,
        limit: query.limit,
        pages: Math.max(1, Math.ceil(total / query.limit)),
      },
    };
  }

  async adminCounts(): Promise<Record<string, number>> {
    const rows = await this.couponModel
      .aggregate<{
        _id: CouponStatus;
        count: number;
      }>([{ $group: { _id: '$status', count: { $sum: 1 } } }])
      .exec();

    const counts: Record<string, number> = {
      all: 0,
      [CouponStatus.ACTIVE]: 0,
      [CouponStatus.DISABLED]: 0,
    };
    for (const row of rows) {
      counts[row._id] = row.count;
      counts.all += row.count;
    }
    return counts;
  }

  async adminDetail(couponId: string): Promise<CouponView> {
    return this.toView(await this.load(couponId));
  }

  async adminUpdate(couponId: string, dto: UpdateCouponDto): Promise<CouponView> {
    const coupon = await this.load(couponId);
    applyTerms(coupon, dto);
    await coupon.save();
    return this.toView(coupon);
  }

  async adminSetStatus(couponId: string, status: CouponStatus): Promise<CouponView> {
    const coupon = await this.load(couponId);
    coupon.status = status;
    await coupon.save();
    return this.toView(coupon);
  }

  /** The ledger for one coupon — who spent it, on what, for how much. */
  async usageForCoupon(couponId: string): Promise<RedemptionView[]> {
    const coupon = await this.load(couponId);
    return this.ledger({ coupon: coupon._id });
  }

  // -------------------------------------------------------------------------

  private async create(
    dto: CouponTermsDto,
    owner: {
      scope: CouponScope;
      organizer: Types.ObjectId | null;
      createdBy: Types.ObjectId;
      createdByRole: Role;
    },
  ): Promise<CouponView> {
    const terms = readTerms(dto);
    assertCoherent(terms.discountType, terms.discountValue, terms.startsAt, terms.endsAt);

    try {
      const created = await this.couponModel.create({
        ...terms,
        code: normalizeCode(dto.code),
        ...owner,
      });
      return this.toView(created);
    } catch (error) {
      // The unique index is the check — a read-then-write would race two
      // admins typing the same code at once.
      if (isDuplicateKey(error)) {
        throw new ConflictException('That coupon code is already in use.');
      }
      throw error;
    }
  }

  private quoteFor(coupon: CouponDocument, amount: number): CouponQuote {
    const discountAmount = CouponService.discountFor(coupon, amount);
    return {
      couponId: coupon._id.toString(),
      code: coupon.code,
      title: coupon.title,
      description: coupon.description ?? '',
      discountType: coupon.discountType,
      discountValue: coupon.discountValue,
      originalAmount: amount,
      discountAmount,
      finalAmount: Math.max(0, amount - discountAmount),
    };
  }

  /** How many times this customer has already spent each of these coupons. */
  private async usesByCoupon(
    customerId: string,
    couponIds: Types.ObjectId[],
  ): Promise<Map<string, number>> {
    const rows = await this.redemptionModel
      .aggregate<{ _id: Types.ObjectId; count: number }>([
        {
          $match: {
            coupon: { $in: couponIds },
            customer: new Types.ObjectId(customerId),
            status: RedemptionStatus.REDEEMED,
          },
        },
        { $group: { _id: '$coupon', count: { $sum: 1 } } },
      ])
      .exec();

    return new Map(rows.map((row) => [row._id.toString(), row.count]));
  }

  private async ledger(filter: Record<string, unknown>): Promise<RedemptionView[]> {
    const rows = await this.redemptionModel
      .find(filter)
      .populate('customer', 'name')
      .populate('booking', 'ref')
      .populate('organizer', 'name')
      .sort({ redeemedAt: -1 })
      .limit(200)
      .exec();

    return rows.map((row) => {
      const customer = row.customer as unknown as NamedRef | null;
      const booking = row.booking as unknown as BookingRef | null;
      const organizer = row.organizer as unknown as NamedRef | null;
      return {
        id: row._id.toString(),
        code: row.code,
        customerName: customer?.name?.trim() || 'A customer',
        bookingRef: booking?.ref ?? '',
        organizerName: organizer?.name ?? '',
        originalAmount: row.originalAmount,
        discountAmount: row.discountAmount,
        finalAmount: row.finalAmount,
        status: row.status,
        redeemedAt: row.redeemedAt ? row.redeemedAt.toISOString() : null,
      };
    });
  }

  private async releaseClaim(couponId: Types.ObjectId): Promise<void> {
    await this.couponModel
      .findOneAndUpdate({ _id: couponId, usedCount: { $gt: 0 } }, { $inc: { usedCount: -1 } })
      .exec();
  }

  private async requireOrganizer(userId: string) {
    const profile = await this.organizerService.findByUser(userId);
    if (!profile) {
      throw new ForbiddenException('Finish your organizer profile before issuing coupons.');
    }
    return profile;
  }

  /**
   * One of the caller's own coupons.
   *
   * A coupon belonging to somebody else is a 404, not a 403 — an organizer
   * probing ids should not be able to learn which of them exist.
   */
  private async requireOwnCoupon(userId: string, couponId: string): Promise<CouponDocument> {
    const profile = await this.requireOrganizer(userId);
    const coupon = await this.load(couponId);
    if (
      coupon.scope !== CouponScope.ORGANIZER ||
      coupon.organizer?.toString() !== profile._id.toString()
    ) {
      throw new NotFoundException('Coupon not found');
    }
    return coupon;
  }

  private async load(couponId: string): Promise<CouponDocument> {
    if (!Types.ObjectId.isValid(couponId)) throw new NotFoundException('Coupon not found');
    const coupon = await this.couponModel.findById(couponId).populate('organizer', 'name').exec();
    if (!coupon) throw new NotFoundException('Coupon not found');
    return coupon;
  }

  private toView(coupon: CouponDocument, organizerNameHint = ''): CouponView {
    const organizer = coupon.organizer as unknown as NamedRef | Types.ObjectId | null;
    const populated = organizer && typeof organizer === 'object' && 'name' in organizer;

    return {
      id: coupon._id.toString(),
      code: coupon.code,
      title: coupon.title,
      description: coupon.description ?? '',
      scope: coupon.scope,
      organizerId: coupon.organizer ? String((organizer as NamedRef)?._id ?? organizer) : null,
      organizerName: populated ? ((organizer as NamedRef).name ?? '') : organizerNameHint,
      discountType: coupon.discountType,
      discountValue: coupon.discountValue,
      maxDiscount: coupon.maxDiscount,
      minBookingAmount: coupon.minBookingAmount,
      startsAt: coupon.startsAt ? coupon.startsAt.toISOString() : null,
      endsAt: coupon.endsAt ? coupon.endsAt.toISOString() : null,
      usageLimit: coupon.usageLimit,
      perCustomerLimit: coupon.perCustomerLimit,
      usedCount: coupon.usedCount,
      status: coupon.status,
      createdByRole: coupon.createdByRole,
      createdAt: coupon.createdAt ? coupon.createdAt.toISOString() : null,
    };
  }
}

// ---------------------------------------------------------------------------

/** Codes are compared exactly, so they are stored and read in one shape. */
export function normalizeCode(code: string): string {
  return (code ?? '').trim().toUpperCase();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isDuplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000;
}

/** The terms, with the defaults the schema would otherwise have to guess. */
function readTerms(dto: CouponTermsDto) {
  return {
    title: dto.title.trim(),
    description: (dto.description ?? '').trim(),
    discountType: dto.discountType,
    discountValue: dto.discountValue,
    maxDiscount: dto.maxDiscount ?? 0,
    minBookingAmount: dto.minBookingAmount ?? 0,
    startsAt: dto.startsAt ? new Date(dto.startsAt) : null,
    endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
    usageLimit: dto.usageLimit ?? 0,
    perCustomerLimit: dto.perCustomerLimit ?? 1,
  };
}

/**
 * The rules `class-validator` cannot see, because they are about how two
 * fields relate rather than about one field's own shape.
 */
function assertCoherent(
  discountType: CouponDiscountType,
  discountValue: number,
  startsAt: Date | null,
  endsAt: Date | null,
): void {
  if (discountType === CouponDiscountType.PERCENTAGE && discountValue > 100) {
    throw new BadRequestException('A percentage discount cannot be more than 100.');
  }
  if (startsAt && endsAt && endsAt.getTime() <= startsAt.getTime()) {
    throw new BadRequestException('The end date must come after the start date.');
  }
}

/** Applies a partial edit, leaving anything the caller did not send alone. */
function applyTerms(coupon: CouponDocument, dto: UpdateCouponDto): void {
  if (dto.title !== undefined) coupon.title = dto.title.trim();
  if (dto.description !== undefined) coupon.description = dto.description.trim();
  if (dto.discountType !== undefined) coupon.discountType = dto.discountType;
  if (dto.discountValue !== undefined) coupon.discountValue = dto.discountValue;
  if (dto.maxDiscount !== undefined) coupon.maxDiscount = dto.maxDiscount;
  if (dto.minBookingAmount !== undefined) coupon.minBookingAmount = dto.minBookingAmount;
  if (dto.startsAt !== undefined) coupon.startsAt = dto.startsAt ? new Date(dto.startsAt) : null;
  if (dto.endsAt !== undefined) coupon.endsAt = dto.endsAt ? new Date(dto.endsAt) : null;
  if (dto.usageLimit !== undefined) coupon.usageLimit = dto.usageLimit;
  if (dto.perCustomerLimit !== undefined) coupon.perCustomerLimit = dto.perCustomerLimit;

  assertCoherent(coupon.discountType, coupon.discountValue, coupon.startsAt, coupon.endsAt);
}
