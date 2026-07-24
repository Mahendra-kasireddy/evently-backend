import { Injectable } from '@nestjs/common';

import { PlanSubmissionService } from '../plan/plan-submission.service';
import { PlanStatus, PlanSubmissionDocument } from '../plan/schemas/plan-submission.schema';
import { QuoteService, OrganizerRef, LatestQuoteSummary } from '../quote/quote.service';
import { QuoteRequestStatus } from '../quote/schemas/quote-request.schema';
import { BookingService, LatestBookingSummary } from '../booking/booking.service';
import { BookingStatus } from '../booking/schemas/booking.schema';
import { NotificationService } from '../notification/notification.service';

/**
 * The eight stages of a customer's event journey, in ascending priority. The
 * Home "Current Event" card always renders the highest-priority active stage.
 */
export enum CurrentEventStage {
  DRAFT = 'draft', // 1 — plan being drafted
  SUBMITTED = 'submitted', // 2 — plan/request sent, awaiting organizers
  QUOTES_RECEIVED = 'quotes_received', // 3 — at least one quote is in
  QUOTE_ACCEPTED = 'quote_accepted', // 4 — a quote accepted, booking not yet created
  BOOKING_CREATED = 'booking_created', // 5 — booking placed, awaiting confirmation
  BOOKING_CONFIRMED = 'booking_confirmed', // 6 — organizer confirmed
  IN_PROGRESS = 'in_progress', // 7 — event delivery underway
  COMPLETED = 'completed', // 8 — event delivered
}

/** Numeric rank (1–8) used to pick the furthest-along active artifact. */
const STAGE_RANK: Record<CurrentEventStage, number> = {
  [CurrentEventStage.DRAFT]: 1,
  [CurrentEventStage.SUBMITTED]: 2,
  [CurrentEventStage.QUOTES_RECEIVED]: 3,
  [CurrentEventStage.QUOTE_ACCEPTED]: 4,
  [CurrentEventStage.BOOKING_CREATED]: 5,
  [CurrentEventStage.BOOKING_CONFIRMED]: 6,
  [CurrentEventStage.IN_PROGRESS]: 7,
  [CurrentEventStage.COMPLETED]: 8,
};

/**
 * Canonical progress per stage (0–100). A live booking overrides this with its
 * own stored `progress` when that is further along, so the ring never goes
 * backwards once a booking exists.
 */
const STAGE_PROGRESS: Record<CurrentEventStage, number> = {
  [CurrentEventStage.DRAFT]: 8,
  [CurrentEventStage.SUBMITTED]: 22,
  [CurrentEventStage.QUOTES_RECEIVED]: 40,
  [CurrentEventStage.QUOTE_ACCEPTED]: 55,
  [CurrentEventStage.BOOKING_CREATED]: 68,
  [CurrentEventStage.BOOKING_CONFIRMED]: 82,
  [CurrentEventStage.IN_PROGRESS]: 92,
  [CurrentEventStage.COMPLETED]: 100,
};

/**
 * The single "Current Event" object returned to the Home screen. The frontend
 * owns final copy/routing via a stage→UI map; the backend supplies the resolved
 * stage plus the supporting facts (progress, organizer, quote count, booking
 * status, new-activity flag) so the card can render without extra round-trips.
 */
export interface CurrentEvent {
  stage: CurrentEventStage;
  /** 1–8 — convenient for the frontend to compare/label without re-deriving. */
  rank: number;
  /** Domain reference id of the underlying artifact (plan/request/booking). */
  refId: string;
  /** Human-facing code/reference when one exists (plan code or booking ref). */
  refCode: string | null;
  /** Which module owns the underlying artifact. */
  source: 'plan' | 'quote' | 'booking';
  title: string;
  occasion: string;
  progress: number;
  daysToGo: number | null;
  organizer: OrganizerRef | null;
  quoteCount: number;
  bookingStatus: BookingStatus | null;
  /** Accepted quotation id, when a quote has been accepted (deep-links booking). */
  quotationId: string | null;
  /** True when the customer has unread notifications (new activity badge). */
  hasNewActivity: boolean;
}

/** Titleize an occasion slug/label for display, e.g. "wedding" → "Wedding". */
function titleizeOccasion(occasion: string | undefined): string {
  if (!occasion) return 'Your event';
  const t = occasion.trim();
  if (!t) return 'Your event';
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/**
 * Home BFF resolver that composes the plan, quote, booking and notification
 * modules into a single "Current Event". It never writes and never duplicates
 * domain data — it only reads each module's latest active artifact and selects
 * the furthest-along stage.
 */
@Injectable()
export class CurrentEventService {
  constructor(
    private readonly planSubmissionService: PlanSubmissionService,
    private readonly quoteService: QuoteService,
    private readonly bookingService: BookingService,
    private readonly notificationService: NotificationService,
  ) {}

  async resolve(userId: string): Promise<CurrentEvent | null> {
    const [plan, quote, booking, unreadCount] = await Promise.all([
      this.planSubmissionService.getLatestActiveForUser(userId),
      this.quoteService.getLatestActiveForUser(userId),
      // Live bookings only — terminal (completed/cancelled/rejected) excluded.
      this.bookingService.getLatestForUser(userId),
      this.notificationService.unreadCount(userId),
    ]);

    // An accepted quote whose booking already exists is represented by that
    // booking, not by the quote. If the booking is live it is a candidate below;
    // if it has since completed/cancelled, the event is terminal and must NOT
    // resurface on Home via the lingering ACCEPTED request. So drop it here.
    let activeQuote = quote;
    if (activeQuote && activeQuote.status === QuoteRequestStatus.ACCEPTED) {
      const alreadyBooked = await this.bookingService.existsForRequest(userId, activeQuote.id);
      if (alreadyBooked) activeQuote = null;
    }

    const candidates: CurrentEvent[] = [];
    if (booking) candidates.push(this.fromBooking(booking));
    if (activeQuote) candidates.push(this.fromQuote(activeQuote));
    if (plan) candidates.push(this.fromPlan(plan));

    if (candidates.length === 0) return null;

    // Furthest-along stage wins; on a tie, the earlier-pushed (booking > quote >
    // plan) candidate is kept for a stable, source-of-truth ordering.
    const winner = candidates.reduce((best, c) => (c.rank > best.rank ? c : best));
    winner.hasNewActivity = unreadCount > 0;
    return winner;
  }

  // --- per-source mappers -----------------------------------------------------

  private fromBooking(b: LatestBookingSummary): CurrentEvent {
    const stage = this.bookingStage(b.status);
    return {
      stage,
      rank: STAGE_RANK[stage],
      refId: b.id,
      refCode: b.ref,
      source: 'booking',
      title: b.title || titleizeOccasion(undefined),
      occasion: '',
      // A booking carries its own stored progress; never let the card regress
      // below the canonical floor for its stage.
      progress: Math.max(b.progress ?? 0, STAGE_PROGRESS[stage]),
      daysToGo: b.daysToGo ?? null,
      organizer: b.organizer,
      quoteCount: 0,
      bookingStatus: b.status,
      quotationId: null,
      hasNewActivity: false,
    };
  }

  private fromQuote(q: LatestQuoteSummary): CurrentEvent {
    const stage = this.quoteStage(q);
    return {
      stage,
      rank: STAGE_RANK[stage],
      refId: q.id,
      refCode: null,
      source: 'quote',
      title: titleizeOccasion(q.occasion),
      occasion: q.occasion,
      progress: STAGE_PROGRESS[stage],
      daysToGo: null,
      organizer: q.organizer,
      quoteCount: q.quoteCount,
      bookingStatus: null,
      quotationId: q.acceptedQuotationId,
      hasNewActivity: false,
    };
  }

  private fromPlan(p: PlanSubmissionDocument): CurrentEvent {
    const stage =
      p.status === PlanStatus.SUBMITTED ? CurrentEventStage.SUBMITTED : CurrentEventStage.DRAFT;
    const refId = p._id.toString();
    return {
      stage,
      rank: STAGE_RANK[stage],
      refId,
      refCode: p.planCode ?? null,
      source: 'plan',
      title: titleizeOccasion(p.occasion),
      occasion: p.occasion,
      progress: STAGE_PROGRESS[stage],
      daysToGo: null,
      organizer: null,
      quoteCount: 0,
      bookingStatus: null,
      quotationId: null,
      hasNewActivity: false,
    };
  }

  // --- stage derivation -------------------------------------------------------

  private bookingStage(status: BookingStatus): CurrentEventStage {
    switch (status) {
      case BookingStatus.CONFIRMED:
        return CurrentEventStage.BOOKING_CONFIRMED;
      case BookingStatus.IN_PROGRESS:
        return CurrentEventStage.IN_PROGRESS;
      case BookingStatus.COMPLETED:
        return CurrentEventStage.COMPLETED;
      // PENDING (and any not-yet-confirmed live state) → "booking created".
      default:
        return CurrentEventStage.BOOKING_CREATED;
    }
  }

  private quoteStage(q: LatestQuoteSummary): CurrentEventStage {
    if (q.status === QuoteRequestStatus.ACCEPTED) return CurrentEventStage.QUOTE_ACCEPTED;
    if (q.status === QuoteRequestStatus.QUOTED || q.quoteCount > 0) {
      return CurrentEventStage.QUOTES_RECEIVED;
    }
    // OPEN with no quotes yet → still "submitted / awaiting organizers".
    return CurrentEventStage.SUBMITTED;
  }
}
