import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  QuoteRequest,
  QuoteRequestDocument,
  QuoteRequestStatus,
} from './schemas/quote-request.schema';
import {
  Quotation,
  QuotationDocument,
  QuotationLine,
  QuotationStatus,
} from './schemas/quotation.schema';
import { RequestQuotesDto } from './dto/request-quotes.dto';
import { RequestQuoteFromOrganizerDto } from './dto/request-quote-from-organizer.dto';
import { QuotationLineDto, RespondQuotationDto } from './dto/respond-quotation.dto';
import { UpdateQuotationDto } from './dto/update-quotation.dto';
import { OrganizerService } from '../organizer/organizer.service';
import { PlanService } from '../plan/plan.service';
import {
  OrganizerProfile,
  OrganizerProfileDocument,
} from '../organizer/schemas/organizer-profile.schema';
import { NotificationService } from '../notification/notification.service';
import { NotificationType } from '../notification/schemas/notification.schema';

const ORG_FIELDS = 'name initials avatarColor tier rating reviews user';

/**
 * How long a broadcast stays open for quotes.
 *
 * A deadline is what turns "waiting" into "waiting until Friday" — for the
 * customer deciding when to chase, and for the organizer deciding whether this
 * is still worth pricing.
 */
const QUOTE_RESPONSE_WINDOW_DAYS = 7;

/**
 * How many organizers one broadcast reaches.
 *
 * Bounded because every recipient is a person who gets a notification and is
 * expected to price the job. Sending one brief to forty organizers is how a
 * marketplace teaches its supply side to ignore it.
 */
const BROADCAST_LIMIT = 6;

/** Minimal organizer identity surfaced on the Home "Current Event" card. */
export interface OrganizerRef {
  id: string;
  name: string;
  initials: string;
  avatarColor: string;
  tier: string;
  rating: number;
}

/**
 * One organizer's response to a request, as listed on the customer's My Events
 * screen. Deliberately thin: enough to recognise who replied and what it costs,
 * without shipping every line item for every quotation on the page. The full
 * breakdown is loaded by the comparison screen for the one request being opened.
 */
export interface QuoteResponseSummary {
  quotationId: string;
  status: QuotationStatus;
  grandTotal: number;
  /** Payable up front to confirm — computed by the API, never client-side. */
  advanceAmount: number;
  siteVisitSuggested: boolean;
  sentAt: Date | undefined;
  organizer: OrganizerRef | null;
}

/** Latest active quote request summary consumed by the Home BFF resolver. */
export interface LatestQuoteSummary {
  id: string;
  occasion: string;
  /**
   * The brief's own words for date, place and headcount. Each is '' when the
   * customer left it out, never a filled-in default — the Home card shows
   * these verbatim and must not present a guess as the customer's answer.
   */
  when: string;
  where: string;
  guests: string;
  status: QuoteRequestStatus;
  quoteCount: number;
  /**
   * The cheapest and dearest live quote on this request, in rupees, or 0 when
   * none have arrived. Computed here rather than on the client because the
   * client is never sent the quotations behind the Home card — only the two
   * figures the card shows.
   */
  lowestQuote: number;
  highestQuote: number;
  acceptedQuotationId: string | null;
  organizer: OrganizerRef | null;
  /**
   * The quotes themselves, one row per organizer who replied.
   *
   * Enough for the Home card to name each one and show what they asked for,
   * without a second call to fetch the request the card is already about.
   */
  quotes: QuoteRowSummary[];
  /**
   * Who the brief went to, who has answered, and who has not — read from the
   * request's stored recipient list. `sentToCount` is 0 for requests made
   * before recipients were recorded, and the card then says how many quotes
   * arrived rather than inventing a denominator.
   */
  sentToCount: number;
  awaiting: OrganizerRef[];
  /** Whole days until the request stops taking quotes; null if it never does. */
  closesInDays: number | null;
  /**
   * The plan this brief was built from, when the customer used the wizard.
   *
   * Home needs it to tell one event from two: a plan and the brief it produced
   * are the same event, and nothing ever moves that plan out of SUBMITTED, so
   * without this the customer would see their Naming ceremony twice.
   */
  planId: string | null;
  createdAt: Date | undefined;
  updatedAt: Date | undefined;
}

/** One organizer's reply, as the Home card lists it. */
export interface QuoteRowSummary {
  id: string;
  organizer: OrganizerRef | null;
  total: number;
  /** How many priced lines it breaks into — the card says "7 line items". */
  lineItemCount: number;
  /** When it landed, so the card can say "2h ago". */
  repliedAt: Date | undefined;
}

/** Normalizes a populated organizer ref (or ObjectId) into an OrganizerRef. */
export function toOrganizerRef(org: unknown): OrganizerRef | null {
  if (!org || typeof org !== 'object') return null;
  const o = org as Record<string, unknown>;
  // Unpopulated (plain ObjectId) — no display fields available.
  if (!('name' in o)) return null;
  const id = (o._id ?? o.id) as { toString(): string } | undefined;
  return {
    id: id ? id.toString() : '',
    name: String(o.name ?? ''),
    initials: String(o.initials ?? ''),
    avatarColor: String(o.avatarColor ?? ''),
    tier: String(o.tier ?? ''),
    rating: typeof o.rating === 'number' ? o.rating : 0,
  };
}

/**
 * Everything a booking needs from an accepted quotation, checked and priced.
 *
 * Named rather than inline because it is now the contract two modules read
 * against: BookingService writes the booking from it, and CouponService judges
 * a coupon against the same `amount` and `organizerId`. One shape means the
 * discount can never be computed against a total the booking did not use.
 */
export interface BookingSeed {
  quotationId: string;
  requestId: string | null;
  organizerId: string | null;
  customerId: string;
  amount: number;
  occasion: string;
  when: string;
  where: string;
  guests: string;
  advancePercentage: number;
  advanceAmount: number;
}

@Injectable()
export class QuoteService {
  private readonly logger = new Logger(QuoteService.name);

  constructor(
    @InjectModel(QuoteRequest.name)
    private readonly quoteModel: Model<QuoteRequestDocument>,
    @InjectModel(Quotation.name)
    private readonly quotationModel: Model<QuotationDocument>,
    @InjectModel(OrganizerProfile.name)
    private readonly organizerModel: Model<OrganizerProfileDocument>,
    private readonly organizerService: OrganizerService,
    private readonly planService: PlanService,
    private readonly notificationService: NotificationService,
  ) {}

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async notify(
    userId: Types.ObjectId | string | null | undefined,
    title: string,
    body: string,
    type: NotificationType,
    link: string,
  ): Promise<void> {
    if (!userId) return;
    try {
      await this.notificationService.create(userId.toString(), title, body, type, link);
    } catch (err) {
      this.logger.warn(`Notification failed: ${String(err)}`);
    }
  }

  /** Fills optional DTO line fields with defaults to match the stored shape. */
  private normalizeLines(lines: QuotationLineDto[]): QuotationLine[] {
    return lines.map((li) => ({
      key: li.key ?? '',
      title: li.title,
      subtitle: li.subtitle ?? '',
      price: li.price,
      note: li.note ?? '',
      subItems: (li.subItems ?? []).map((s) => ({ label: s.label, value: s.value })),
    }));
  }

  private computeTotals(
    lineItems: Array<{ price: number }>,
    taxRate: number,
  ): { subtotal: number; taxAmount: number; grandTotal: number } {
    const subtotal = lineItems.reduce((sum, li) => sum + (li.price || 0), 0);
    const taxAmount = Math.round((subtotal * taxRate) / 100);
    return { subtotal, taxAmount, grandTotal: subtotal + taxAmount };
  }

  private quotationView(q: QuotationDocument): Record<string, unknown> {
    const org = q.organizer as unknown as Record<string, unknown> | null;
    const organizer =
      org && typeof org === 'object' && 'name' in org
        ? {
            id: (org._id as Types.ObjectId).toString(),
            name: org.name,
            initials: org.initials,
            avatarColor: org.avatarColor,
            tier: org.tier,
            rating: org.rating,
            reviews: org.reviews,
          }
        : null;
    return {
      id: q._id.toString(),
      requestId: q.request.toString(),
      status: q.status,
      lineItems: q.lineItems.map((li) => ({
        key: li.key,
        title: li.title,
        subtitle: li.subtitle,
        price: li.price,
        note: li.note,
        subItems: li.subItems,
      })),
      subtotal: q.subtotal,
      taxRate: q.taxRate,
      taxAmount: q.taxAmount,
      grandTotal: q.grandTotal,
      advancePercentage: q.advancePercentage,
      // Derived server-side so the organizer's builder, the customer's quote
      // detail and the booking screen can never disagree on the figure.
      advanceAmount: Math.round((q.grandTotal * q.advancePercentage) / 100),
      siteVisitSuggested: q.siteVisitSuggested,
      notes: q.notes,
      organizer,
      createdAt: q.createdAt,
      updatedAt: q.updatedAt,
    };
  }

  /** Builds a chronological status timeline for a request from its documents. */
  private buildTimeline(
    request: QuoteRequestDocument,
    quotations: QuotationDocument[],
  ): Array<{ key: string; label: string; at: Date | undefined }> {
    const events: Array<{ key: string; label: string; at: Date | undefined }> = [
      { key: 'requested', label: 'Quote request sent', at: request.createdAt },
    ];
    for (const q of quotations) {
      const orgName = (q.organizer as unknown as { name?: string })?.name ?? 'An organizer';
      if (q.status === QuotationStatus.WITHDRAWN) {
        events.push({
          key: 'withdrawn',
          label: `${orgName} withdrew their quote`,
          at: q.updatedAt,
        });
      } else if (q.status === QuotationStatus.ACCEPTED) {
        events.push({ key: 'accepted', label: `You accepted ${orgName}'s quote`, at: q.updatedAt });
      } else if (q.status === QuotationStatus.REJECTED) {
        events.push({ key: 'rejected', label: `${orgName}'s quote was declined`, at: q.updatedAt });
      } else {
        events.push({
          key: 'quoted',
          label: `${orgName} sent a quote`,
          at: q.createdAt,
        });
      }
    }
    if (request.status === QuoteRequestStatus.CANCELLED) {
      events.push({ key: 'cancelled', label: 'You cancelled this request', at: request.updatedAt });
    }
    return events.sort((a, b) => (a.at?.getTime() ?? 0) - (b.at?.getTime() ?? 0));
  }

  private toObjectId(id: string): Types.ObjectId {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Not found');
    return new Types.ObjectId(id);
  }

  // ---------------------------------------------------------------------------
  // Customer — requesting quotes (existing behaviour, preserved)
  // ---------------------------------------------------------------------------

  /** Open request from the hero draft, broadcast to matched organizers. */
  /**
   * A brief broadcast to the organizers who match it.
   *
   * The recipients are resolved and stored rather than left implicit. The old
   * behaviour — `organizer: null`, matched by every organizer's inbox — meant
   * the request reached everybody, told nobody, and could not answer "who has
   * this gone to" for either side.
   */
  async createFromDraft(userId: string, dto: RequestQuotesDto): Promise<QuoteRequestDocument> {
    const recipients = await this.resolveRecipients(dto);

    const request = await this.quoteModel.create({
      customer: new Types.ObjectId(userId),
      organizer: null,
      plan: dto.planId ? new Types.ObjectId(dto.planId) : null,
      occasion: dto.occasion,
      when: dto.when ?? '',
      where: dto.where ?? '',
      guests: dto.guests ?? '',
      budget: dto.budget ?? '',
      categories: dto.categories ?? [],
      ideas: dto.ideas ?? '',
      recipients,
      closesAt: closingDate(),
    });

    await this.notifyRecipients(recipients, dto.occasion);
    return request;
  }

  /**
   * Which organizers a brief goes to.
   *
   * Delegated to the recommendation engine the Plan wizard already uses, so
   * the organizers a customer is shown and the organizers their brief reaches
   * are chosen by one rule. A second matcher here would be a second answer to
   * the same question, and the two would drift.
   */
  private async resolveRecipients(dto: RequestQuotesDto): Promise<Types.ObjectId[]> {
    try {
      const { area, city } = splitWhere(dto.where ?? '');
      const matched = await this.planService.recommend({
        categories: dto.categories ?? [],
        occasion: dto.occasion,
        guests: dto.guests,
        budget: dto.budget,
        city,
        area,
      });
      if (matched.length === 0) {
        /*
         * Not an error, but not nothing either: the brief will still be
         * visible to every organizer (see the inbox query), yet it can never
         * say who it went to, and the customer's card loses its denominator.
         * Silence here is what made "sent to 0" impossible to explain.
         */
        this.logger.warn(
          `Brief for "${dto.occasion || 'event'}" matched no organizers — it will be broadcast unaddressed.`,
        );
      }
      return matched.slice(0, BROADCAST_LIMIT).map((m) => new Types.ObjectId(m.id));
    } catch (error) {
      /*
       * A brief that cannot be matched is still a brief. Losing the customer's
       * request because the recommender failed would be far worse than an
       * unaddressed one, which the old code produced every time anyway. It is
       * logged rather than swallowed so the next one is diagnosable.
       */
      this.logger.error(
        `Could not match organizers for a "${dto.occasion || 'event'}" brief; broadcasting unaddressed.`,
        error instanceof Error ? error.stack : undefined,
      );
      return [];
    }
  }

  /** Tells each recipient there is something to price. Best-effort per one. */
  private async notifyRecipients(recipients: Types.ObjectId[], occasion: string): Promise<void> {
    await Promise.all(
      recipients.map((id) =>
        this.notifyOrganizerProfile(
          id.toString(),
          'New quote request',
          `A customer wants quotes for their ${occasion || 'event'}. Reply from your dashboard before it closes.`,
          NotificationType.QUOTE,
          '/organizer/quotes',
        ),
      ),
    );
  }

  /** Request targeted at a single organizer ("Get quote" on a card). */
  async createForOrganizer(
    userId: string,
    dto: RequestQuoteFromOrganizerDto,
  ): Promise<QuoteRequestDocument> {
    const quote = await this.quoteModel.create({
      customer: new Types.ObjectId(userId),
      organizer: new Types.ObjectId(dto.organizerId),
      plan: dto.planId ? new Types.ObjectId(dto.planId) : null,
      occasion: dto.occasion,
      when: dto.when ?? '',
      where: dto.where ?? '',
      guests: dto.guests ?? '',
      budget: dto.budget ?? '',
      categories: dto.categories ?? [],
      ideas: dto.ideas ?? '',
      // One recipient, recorded the same way a broadcast records six, so every
      // request answers "who was this sent to" the same way.
      recipients: [new Types.ObjectId(dto.organizerId)],
      closesAt: closingDate(),
    });
    await this.notifyOrganizerProfile(
      dto.organizerId,
      'New quote request',
      `A customer requested a quote for their ${dto.occasion || 'event'}. Review and reply from your dashboard.`,
      NotificationType.QUOTE,
      '/organizer/quotes',
    );
    return quote;
  }

  private async notifyOrganizerProfile(
    organizerId: string,
    title: string,
    body: string,
    type: NotificationType,
    link: string,
  ): Promise<void> {
    try {
      const profile = await this.organizerService.findById(organizerId);
      await this.notify(profile.user, title, body, type, link);
    } catch (err) {
      this.logger.warn(`Organizer lookup for notification failed: ${String(err)}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Customer — viewing / acting on quotes
  // ---------------------------------------------------------------------------

  /**
   * The customer's quote requests, newest first (list + history), each carrying
   * every live organizer response to it, how many there are, and when the latest
   * arrived.
   *
   * `responses` is what lets My Events answer "who replied to *this* event, and
   * for how much" on one screen: the customer picks the event first and the
   * organizers second, rather than landing on a comparison for a request they
   * did not choose. It is fetched in a single query across all of the customer's
   * requests and grouped in memory — one round-trip regardless of how many
   * events they have.
   *
   * Drafts and withdrawn quotations are excluded throughout: neither is
   * something the customer can act on, so neither should be counted or listed.
   */
  async listForUser(userId: string): Promise<Record<string, unknown>[]> {
    const requests = await this.quoteModel
      .find({ customer: new Types.ObjectId(userId) })
      .populate('organizer', ORG_FIELDS)
      .sort({ createdAt: -1 })
      .exec();
    if (requests.length === 0) return [];

    const quotations = await this.quotationModel
      .find({
        request: { $in: requests.map((r) => r._id) },
        status: { $nin: [QuotationStatus.DRAFT, QuotationStatus.WITHDRAWN] },
      })
      .populate('organizer', ORG_FIELDS)
      // Newest first, matching the order the request timeline reports them in.
      .sort({ updatedAt: -1 })
      .exec();

    const byRequest = new Map<string, QuoteResponseSummary[]>();
    for (const q of quotations) {
      const key = q.request.toString();
      const list = byRequest.get(key) ?? [];
      list.push({
        quotationId: q._id.toString(),
        status: q.status,
        grandTotal: q.grandTotal,
        advanceAmount: Math.round((q.grandTotal * q.advancePercentage) / 100),
        siteVisitSuggested: q.siteVisitSuggested,
        sentAt: q.updatedAt ?? q.createdAt,
        organizer: toOrganizerRef(q.organizer),
      });
      byRequest.set(key, list);
    }

    return requests.map((r) => {
      const responses = byRequest.get(r._id.toString()) ?? [];
      return {
        ...(r.toJSON() as Record<string, unknown>),
        // Explicit and stringified: My Events joins plan → request → booking on
        // this, and a raw ObjectId would not survive the client comparison.
        planId: r.plan ? r.plan.toString() : null,
        responses,
        quotationCount: responses.length,
        lastQuotedAt: responses[0]?.sentAt ?? null,
      };
    });
  }

  /**
   * Latest *active* quote request for the Home "Current Event" resolver, plus a
   * live count of received quotes and the assigned organizer (targeted request
   * or, once accepted, the winning quotation's organizer). Cancelled/closed
   * requests are excluded. Returns null when there is none.
   *
   * Reuses the same collections as the workspace/quotes screens — no new data.
   */
  async getLatestActiveForUser(userId: string): Promise<LatestQuoteSummary | null> {
    const customer = new Types.ObjectId(userId);
    const request = await this.quoteModel
      .findOne({
        customer,
        status: {
          $in: [QuoteRequestStatus.OPEN, QuoteRequestStatus.QUOTED, QuoteRequestStatus.ACCEPTED],
        },
      })
      .populate('organizer', ORG_FIELDS)
      .sort({ createdAt: -1 })
      .exec();
    if (!request) return null;

    // Live quotes: exclude withdrawn ones (and organizers' unsent drafts) so
    // the count matches what the customer can actually act on.
    const quotations = await this.quotationModel
      .find({
        request: request._id,
        status: { $nin: [QuotationStatus.WITHDRAWN, QuotationStatus.DRAFT] },
      })
      .populate('organizer', ORG_FIELDS)
      .exec();

    const accepted = quotations.find((q) => q.status === QuotationStatus.ACCEPTED);
    const organizerDoc = accepted?.organizer ?? request.organizer;

    return {
      id: request._id.toString(),
      occasion: request.occasion,
      when: request.when,
      where: request.where,
      guests: request.guests,
      status: request.status,
      quoteCount: quotations.length,
      ...this.spread(quotations.map((q) => q.grandTotal ?? 0)),
      acceptedQuotationId: accepted?._id.toString() ?? null,
      organizer: toOrganizerRef(organizerDoc),
      /* Cheapest first: the card's rows are a comparison, and a comparison
         that arrives in the order organizers happened to reply is not one. */
      quotes: quotations
        .map((q) => ({
          id: q._id.toString(),
          organizer: toOrganizerRef(q.organizer),
          total: q.grandTotal ?? 0,
          lineItemCount: (q.lineItems ?? []).length,
          repliedAt: q.updatedAt ?? q.createdAt,
        }))
        .sort((a, b) => a.total - b.total),
      sentToCount: (request.recipients ?? []).length,
      awaiting: await this.awaitingOrganizers(request, quotations),
      closesInDays: request.closesAt ? daysUntil(request.closesAt) : null,
      planId: request.plan ? request.plan.toString() : null,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
    };
  }

  /**
   * The cheapest and dearest of a set of totals.
   *
   * Zeros are dropped rather than counted as a free quote — an organizer who
   * has not priced their response should not make the lowest figure ₹0 and
   * anchor the customer's expectation to a number nobody offered.
   */
  private spread(totals: number[]): { lowestQuote: number; highestQuote: number } {
    const priced = totals.filter((t) => Number.isFinite(t) && t > 0);
    if (priced.length === 0) return { lowestQuote: 0, highestQuote: 0 };
    return { lowestQuote: Math.min(...priced), highestQuote: Math.max(...priced) };
  }

  /**
   * The four facts a brief carries, by request id, with no ownership check —
   * callers must already hold a record that references this request (a
   * Booking, for instance). It returns nothing but the customer's own words,
   * so it exposes no organizer or pricing detail.
   */
  async getRequestBrief(
    requestId: string,
  ): Promise<{ occasion: string; when: string; where: string; guests: string } | null> {
    const request = await this.quoteModel
      .findById(this.toObjectId(requestId))
      .select('occasion when where guests')
      .exec();
    if (!request) return null;
    return {
      occasion: request.occasion ?? '',
      when: request.when ?? '',
      where: request.where ?? '',
      guests: request.guests ?? '',
    };
  }

  private async ownedRequest(userId: string, requestId: string): Promise<QuoteRequestDocument> {
    const request = await this.quoteModel
      .findOne({ _id: this.toObjectId(requestId), customer: new Types.ObjectId(userId) })
      .exec();
    if (!request) throw new NotFoundException('Quote request not found');
    return request;
  }

  /** One request with its quotations + a derived status timeline. */
  async getRequest(userId: string, requestId: string): Promise<Record<string, unknown>> {
    const request = await this.ownedRequest(userId, requestId);
    const quotations = await this.quotationModel
      // Drafts are the organizer's private working copy — never surfaced here.
      .find({ request: request._id, status: { $ne: QuotationStatus.DRAFT } })
      .populate('organizer', ORG_FIELDS)
      .sort({ createdAt: 1 })
      .exec();

    return {
      id: request._id.toString(),
      occasion: request.occasion,
      when: request.when,
      where: request.where,
      guests: request.guests,
      budget: request.budget,
      categories: request.categories,
      ideas: request.ideas,
      status: request.status,
      createdAt: request.createdAt,
      quotations: quotations.map((q) => this.quotationView(q)),
      timeline: this.buildTimeline(request, quotations),
      ...(await this.responseState(request, quotations)),
    };
  }

  /** The recipients who have not sent a quote yet, named. */
  private async awaitingOrganizers(
    request: QuoteRequestDocument,
    quotations: QuotationDocument[],
  ): Promise<OrganizerRef[]> {
    const replied = new Set(
      quotations
        .map((q) => (q.organizer as unknown as { _id?: Types.ObjectId })?._id?.toString())
        .filter(Boolean) as string[],
    );
    const waiting = (request.recipients ?? []).filter((id) => !replied.has(id.toString()));
    if (waiting.length === 0) return [];

    const rows = await this.organizerModel
      .find({ _id: { $in: waiting } })
      .select('name initials avatarColor')
      .exec();
    return rows.map((o) => toOrganizerRef(o)).filter(Boolean) as OrganizerRef[];
  }

  /**
   * Who the brief reached, who answered, and how long is left.
   *
   * Every figure comes from the stored recipient list, so "3 of 4 replied" is
   * a count of real organizers rather than a count of quotes dressed up as
   * one. A request from before recipients were recorded reports what it can —
   * the replies — and says nothing about who else it went to, instead of
   * inventing a denominator.
   */
  private async responseState(
    request: QuoteRequestDocument,
    quotations: QuotationDocument[],
  ): Promise<Record<string, unknown>> {
    const recipients = request.recipients ?? [];
    const replied = new Set(
      quotations
        .map((q) => (q.organizer as unknown as { _id?: Types.ObjectId })?._id?.toString())
        .filter(Boolean) as string[],
    );

    const closesAt = request.closesAt ?? null;
    return {
      sentToCount: recipients.length,
      repliedCount: replied.size,
      /* Named, because "one organizer hasn't replied" is a fact the customer
         can act on and "3 of 4" on its own is not. */
      awaiting: await this.awaitingOrganizers(request, quotations),
      closesAt,
      /* Null rather than 0 when there is no deadline — a request that never
         closes must not render as one closing today. */
      closesInDays: closesAt ? daysUntil(closesAt) : null,
    };
  }

  /**
   * Booking seed for an accepted quotation. Reused by the Booking module so the
   * quote internals stay encapsulated here. Throws unless the quotation is owned
   * by the customer and has been accepted.
   */
  /**
   * The organizers this customer currently has a live quotation from.
   *
   * Used to decide whose coupons are worth showing on Home. Draft, withdrawn
   * and rejected quotations are excluded because they are not a conversation
   * any more; an accepted one is kept, because that is precisely the quotation
   * a coupon is about to be applied to at checkout.
   *
   * Live bookings are deliberately not included: the advance has already been
   * settled on those, so a coupon can no longer change what they cost, and
   * advertising one against them would be advertising a discount the customer
   * has missed.
   */
  async organizerIdsForCustomer(userId: string): Promise<string[]> {
    if (!Types.ObjectId.isValid(userId)) return [];

    const ids = await this.quotationModel
      .distinct('organizer', {
        customer: new Types.ObjectId(userId),
        status: {
          $in: [QuotationStatus.SENT, QuotationStatus.UPDATED, QuotationStatus.ACCEPTED],
        },
      })
      .exec();

    return (ids as Types.ObjectId[]).filter(Boolean).map((id) => id.toString());
  }

  /** An organizer's display name, for a screen that has only their id. */
  async organizerNameById(organizerId: string): Promise<string> {
    if (!Types.ObjectId.isValid(organizerId)) return '';
    const organizer = await this.organizerModel.findById(organizerId).select('name').exec();
    return organizer?.name ?? '';
  }

  async getBookingSeed(userId: string, quotationId: string): Promise<BookingSeed> {
    const q = await this.quotationModel
      .findOne({ _id: this.toObjectId(quotationId), customer: new Types.ObjectId(userId) })
      .exec();
    if (!q) throw new NotFoundException('Quotation not found');
    if (q.status !== QuotationStatus.ACCEPTED) {
      throw new ForbiddenException('Only an accepted quotation can be booked');
    }
    const request = await this.quoteModel.findById(q.request).exec();
    return {
      quotationId: q._id.toString(),
      requestId: q.request ? q.request.toString() : null,
      organizerId: q.organizer ? q.organizer.toString() : null,
      customerId: q.customer.toString(),
      amount: q.grandTotal,
      occasion: request?.occasion ?? '',
      when: request?.when ?? '',
      where: request?.where ?? '',
      guests: request?.guests ?? '',
      advancePercentage: q.advancePercentage,
      advanceAmount: Math.round((q.grandTotal * q.advancePercentage) / 100),
    };
  }

  /** A single quotation the customer owns (quote-detail screen). */
  async getQuotation(userId: string, quotationId: string): Promise<Record<string, unknown>> {
    const q = await this.quotationModel
      .findOne({ _id: this.toObjectId(quotationId), customer: new Types.ObjectId(userId) })
      .populate('organizer', ORG_FIELDS)
      .exec();
    if (!q) throw new NotFoundException('Quotation not found');
    return this.quotationView(q);
  }

  /** Customer accepts a quotation — siblings are rejected, request is closed as ACCEPTED. */
  async acceptQuotation(userId: string, quotationId: string): Promise<Record<string, unknown>> {
    const q = await this.quotationModel
      .findOne({ _id: this.toObjectId(quotationId), customer: new Types.ObjectId(userId) })
      .exec();
    if (!q) throw new NotFoundException('Quotation not found');
    if (q.status === QuotationStatus.WITHDRAWN) {
      throw new ForbiddenException('This quote has been withdrawn');
    }

    q.status = QuotationStatus.ACCEPTED;
    await q.save();

    // Reject the other live quotations on the same request.
    await this.quotationModel
      .updateMany(
        {
          request: q.request,
          _id: { $ne: q._id },
          status: { $in: [QuotationStatus.SENT, QuotationStatus.UPDATED] },
        },
        { status: QuotationStatus.REJECTED },
      )
      .exec();

    await this.quoteModel
      .updateOne({ _id: q.request }, { status: QuoteRequestStatus.ACCEPTED })
      .exec();

    await this.notifyOrganizerProfile(
      q.organizer.toString(),
      'Your quote was accepted 🎉',
      'A customer accepted your quotation. Head to your dashboard to confirm the booking.',
      NotificationType.QUOTE,
      '/organizer/quotes',
    );

    const populated = await q.populate('organizer', ORG_FIELDS);
    return this.quotationView(populated);
  }

  /** Customer rejects a single quotation. */
  async rejectQuotation(userId: string, quotationId: string): Promise<Record<string, unknown>> {
    const q = await this.quotationModel
      .findOne({ _id: this.toObjectId(quotationId), customer: new Types.ObjectId(userId) })
      .exec();
    if (!q) throw new NotFoundException('Quotation not found');

    q.status = QuotationStatus.REJECTED;
    await q.save();

    await this.notifyOrganizerProfile(
      q.organizer.toString(),
      'Quote declined',
      'A customer declined your quotation for now. You can revise and resend if you like.',
      NotificationType.QUOTE,
      '/organizer/quotes',
    );

    const populated = await q.populate('organizer', ORG_FIELDS);
    return this.quotationView(populated);
  }

  /** Customer cancels a whole request; live quotations are rejected. */
  async cancelRequest(userId: string, requestId: string): Promise<Record<string, unknown>> {
    const request = await this.ownedRequest(userId, requestId);
    if (request.status === QuoteRequestStatus.ACCEPTED) {
      throw new ForbiddenException('An accepted request cannot be cancelled');
    }
    request.status = QuoteRequestStatus.CANCELLED;
    await request.save();

    const live = await this.quotationModel
      .find({
        request: request._id,
        status: { $in: [QuotationStatus.SENT, QuotationStatus.UPDATED] },
      })
      .exec();
    await this.quotationModel
      .updateMany(
        { request: request._id, status: { $in: [QuotationStatus.SENT, QuotationStatus.UPDATED] } },
        { status: QuotationStatus.REJECTED },
      )
      .exec();

    // Notify any organizers who had live quotes, plus a targeted organizer.
    const organizerIds = new Set(live.map((q) => q.organizer.toString()));
    if (request.organizer) organizerIds.add(request.organizer.toString());
    for (const orgId of organizerIds) {
      await this.notifyOrganizerProfile(
        orgId,
        'Quote request cancelled',
        `A customer cancelled their ${request.occasion || 'event'} request.`,
        NotificationType.QUOTE,
        '/organizer/quotes',
      );
    }

    return { id: request._id.toString(), status: request.status };
  }

  // ---------------------------------------------------------------------------
  // Organizer — responding to requests
  // ---------------------------------------------------------------------------

  private async organizerProfileId(organizerUserId: string): Promise<Types.ObjectId> {
    const profile = await this.organizerService.findByUser(organizerUserId);
    if (!profile) {
      throw new ForbiddenException('No organizer profile is linked to your account');
    }
    return profile._id;
  }

  /**
   * Shortens a customer's name for the organizer-facing enquiry list:
   * `Priya Reddy` → `Priya R.`. An enquiry is pre-engagement — the organizer
   * has not been hired yet — so this gives them enough to address the customer
   * personally without the full identity going out to every matched organizer
   * on an open (broadcast) request.
   */
  private shortCustomerName(name?: string | null): string {
    const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
    const first = parts[0];
    if (!first) return '';
    const last = parts.length > 1 ? parts[parts.length - 1] : undefined;
    return last ? `${first} ${last.charAt(0).toUpperCase()}.` : first;
  }

  /** Requests visible to an organizer: targeted at them or open to all. */
  async listIncoming(organizerUserId: string): Promise<Record<string, unknown>[]> {
    const profileId = await this.organizerProfileId(organizerUserId);
    const requests = await this.quoteModel
      .find({
        $or: [
          // Sent to this organizer by name, or included in a broadcast.
          { organizer: profileId },
          { recipients: profileId },
          /*
           * Requests from before recipients were recorded. They were broadcast
           * to everyone by having no organizer at all, and they keep that
           * behaviour rather than vanishing from every inbox at once.
           */
          { organizer: null, recipients: { $size: 0 } },
        ],
        status: { $ne: QuoteRequestStatus.CANCELLED },
      })
      // This list is the organizer's inbox, so it has to say *who* is asking.
      // Pulling just the name alongside the request avoids N extra round-trips
      // from the client.
      .populate<{ customer: { name?: string } }>('customer', 'name')
      .sort({ createdAt: -1 })
      .exec();

    const mine = await this.quotationModel.find({ organizer: profileId }).exec();
    const byRequest = new Map(mine.map((q) => [q.request.toString(), q]));

    return requests.map((r) => ({
      id: r._id.toString(),
      customerName: this.shortCustomerName(
        (r.customer as unknown as { name?: string } | null)?.name,
      ),
      occasion: r.occasion,
      when: r.when,
      where: r.where,
      guests: r.guests,
      budget: r.budget,
      categories: r.categories,
      ideas: r.ideas,
      status: r.status,
      createdAt: r.createdAt,
      myQuotation: byRequest.has(r._id.toString())
        ? this.quotationView(byRequest.get(r._id.toString()) as QuotationDocument)
        : null,
    }));
  }

  /** Organizer submits a priced quotation for a request. */
  async respond(
    organizerUserId: string,
    requestId: string,
    dto: RespondQuotationDto,
  ): Promise<Record<string, unknown>> {
    const profileId = await this.organizerProfileId(organizerUserId);
    const request = await this.quoteModel.findById(this.toObjectId(requestId)).exec();
    if (!request) throw new NotFoundException('Quote request not found');
    if (request.status === QuoteRequestStatus.CANCELLED) {
      throw new ForbiddenException('This request has been cancelled');
    }

    const taxRate = dto.taxRate ?? 18;
    const lineItems = this.normalizeLines(dto.lineItems);
    const totals = this.computeTotals(lineItems, taxRate);
    const isDraft = dto.asDraft === true;

    const quotation = await this.quotationModel.create({
      request: request._id,
      organizer: profileId,
      customer: request.customer,
      lineItems,
      taxRate,
      notes: dto.notes ?? '',
      advancePercentage: dto.advancePercentage ?? 30,
      siteVisitSuggested: dto.siteVisitSuggested ?? false,
      status: isDraft ? QuotationStatus.DRAFT : QuotationStatus.SENT,
      ...totals,
    });

    // A draft is invisible to the customer, so it must not move the request out
    // of "open" or trigger a notification.
    if (!isDraft) {
      if (request.status === QuoteRequestStatus.OPEN) {
        request.status = QuoteRequestStatus.QUOTED;
        await request.save();
      }

      // Deep-links to the event inside My Events, so "compare it now" opens the
      // responses for *this* request rather than the hub's full list.
      await this.notify(
        request.customer,
        'You have a new quote',
        `An organizer sent a quotation for your ${request.occasion || 'event'}. Compare it now.`,
        NotificationType.QUOTE,
        `/workspace/${request._id.toString()}`,
      );
    }

    const populated = await quotation.populate('organizer', ORG_FIELDS);
    return this.quotationView(populated);
  }

  private async ownedQuotation(
    organizerUserId: string,
    quotationId: string,
  ): Promise<QuotationDocument> {
    const profileId = await this.organizerProfileId(organizerUserId);
    const q = await this.quotationModel.findById(this.toObjectId(quotationId)).exec();
    if (!q) throw new NotFoundException('Quotation not found');
    if (q.organizer.toString() !== profileId.toString()) {
      throw new ForbiddenException('You do not own this quotation');
    }
    return q;
  }

  /** Organizer revises an existing quotation. */
  async updateQuotation(
    organizerUserId: string,
    quotationId: string,
    dto: UpdateQuotationDto,
  ): Promise<Record<string, unknown>> {
    const q = await this.ownedQuotation(organizerUserId, quotationId);
    if (q.status === QuotationStatus.ACCEPTED) {
      throw new ForbiddenException('An accepted quotation cannot be edited');
    }

    if (dto.lineItems) q.lineItems = this.normalizeLines(dto.lineItems);
    if (dto.taxRate !== undefined) q.taxRate = dto.taxRate;
    if (dto.notes !== undefined) q.notes = dto.notes;
    if (dto.advancePercentage !== undefined) q.advancePercentage = dto.advancePercentage;
    if (dto.siteVisitSuggested !== undefined) q.siteVisitSuggested = dto.siteVisitSuggested;

    const totals = this.computeTotals(q.lineItems, q.taxRate);
    q.subtotal = totals.subtotal;
    q.taxAmount = totals.taxAmount;
    q.grandTotal = totals.grandTotal;

    // Three cases: a draft being saved again (stays a draft, stays silent), a
    // draft being sent for the first time (becomes SENT and behaves like a new
    // quote), and a revision of an already-sent quote.
    const wasDraft = q.status === QuotationStatus.DRAFT;
    const keepDraft = wasDraft && dto.asDraft !== false;
    q.status = keepDraft
      ? QuotationStatus.DRAFT
      : wasDraft
        ? QuotationStatus.SENT
        : QuotationStatus.UPDATED;
    await q.save();

    if (!keepDraft) {
      if (wasDraft) {
        const request = await this.quoteModel.findById(q.request).exec();
        if (request && request.status === QuoteRequestStatus.OPEN) {
          request.status = QuoteRequestStatus.QUOTED;
          await request.save();
        }
      }
      await this.notify(
        q.customer,
        wasDraft ? 'You have a new quote' : 'A quote was updated',
        wasDraft
          ? 'An organizer sent a quotation for your event. Compare it now.'
          : 'An organizer revised their quotation for your event. Take another look.',
        NotificationType.QUOTE,
        // Straight to this response inside My Events.
        `/workspace/${q.request.toString()}/${q._id.toString()}`,
      );
    }

    const populated = await q.populate('organizer', ORG_FIELDS);
    return this.quotationView(populated);
  }

  /** Organizer withdraws their quotation. */
  async withdrawQuotation(
    organizerUserId: string,
    quotationId: string,
  ): Promise<Record<string, unknown>> {
    const q = await this.ownedQuotation(organizerUserId, quotationId);
    if (q.status === QuotationStatus.ACCEPTED) {
      throw new ForbiddenException('An accepted quotation cannot be withdrawn');
    }
    q.status = QuotationStatus.WITHDRAWN;
    await q.save();

    await this.notify(
      q.customer,
      'A quote was withdrawn',
      'An organizer withdrew their quotation for your event.',
      NotificationType.QUOTE,
      // The response itself is gone — land on the event, which still exists.
      `/workspace/${q.request.toString()}`,
    );

    const populated = await q.populate('organizer', ORG_FIELDS);
    return this.quotationView(populated);
  }
}

// ---------------------------------------------------------------------------

/** The deadline a request created now would carry. */
function closingDate(): Date {
  const closes = new Date();
  closes.setDate(closes.getDate() + QUOTE_RESPONSE_WINDOW_DAYS);
  return closes;
}

/** Whole days left, floored at 0 — a closed request is not "-2 days". */
function daysUntil(when: Date): number {
  const ms = new Date(when).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

/**
 * "Kukatpally, Hyderabad" -> { area, city }.
 *
 * The city is the last part, because an area name can itself contain a comma
 * and the city never does.
 */
function splitWhere(where: string): { area: string; city: string } {
  const parts = (where ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return { area: '', city: '' };
  if (parts.length === 1) return { area: '', city: parts[0] };
  return { area: parts.slice(0, -1).join(', '), city: parts[parts.length - 1] };
}
