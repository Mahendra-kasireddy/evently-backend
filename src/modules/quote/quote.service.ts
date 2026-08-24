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
import { NotificationService } from '../notification/notification.service';
import { NotificationType } from '../notification/schemas/notification.schema';

const ORG_FIELDS = 'name initials avatarColor tier rating reviews user';

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
  status: QuoteRequestStatus;
  quoteCount: number;
  acceptedQuotationId: string | null;
  organizer: OrganizerRef | null;
  createdAt: Date | undefined;
  updatedAt: Date | undefined;
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

@Injectable()
export class QuoteService {
  private readonly logger = new Logger(QuoteService.name);

  constructor(
    @InjectModel(QuoteRequest.name)
    private readonly quoteModel: Model<QuoteRequestDocument>,
    @InjectModel(Quotation.name)
    private readonly quotationModel: Model<QuotationDocument>,
    private readonly organizerService: OrganizerService,
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
  createFromDraft(userId: string, dto: RequestQuotesDto): Promise<QuoteRequestDocument> {
    return this.quoteModel.create({
      customer: new Types.ObjectId(userId),
      organizer: null,
      occasion: dto.occasion,
      when: dto.when ?? '',
      where: dto.where ?? '',
      guests: dto.guests ?? '',
      budget: dto.budget ?? '',
      categories: dto.categories ?? [],
      ideas: dto.ideas ?? '',
    });
  }

  /** Request targeted at a single organizer ("Get quote" on a card). */
  async createForOrganizer(
    userId: string,
    dto: RequestQuoteFromOrganizerDto,
  ): Promise<QuoteRequestDocument> {
    const quote = await this.quoteModel.create({
      customer: new Types.ObjectId(userId),
      organizer: new Types.ObjectId(dto.organizerId),
      occasion: dto.occasion,
      when: dto.when ?? '',
      where: dto.where ?? '',
      guests: dto.guests ?? '',
      budget: dto.budget ?? '',
      categories: dto.categories ?? [],
      ideas: dto.ideas ?? '',
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
      status: request.status,
      quoteCount: quotations.length,
      acceptedQuotationId: accepted?._id.toString() ?? null,
      organizer: toOrganizerRef(organizerDoc),
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
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
    };
  }

  /**
   * Booking seed for an accepted quotation. Reused by the Booking module so the
   * quote internals stay encapsulated here. Throws unless the quotation is owned
   * by the customer and has been accepted.
   */
  async getBookingSeed(
    userId: string,
    quotationId: string,
  ): Promise<{
    quotationId: string;
    requestId: string | null;
    organizerId: string | null;
    customerId: string;
    amount: number;
    occasion: string;
    when: string;
    where: string;
    guests: string;
  }> {
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
        $or: [{ organizer: profileId }, { organizer: null }],
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
