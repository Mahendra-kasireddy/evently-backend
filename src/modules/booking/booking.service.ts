import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Booking,
  BookingDocument,
  BookingStatus,
  BookingTaskStatus,
  ONGOING_BOOKING_STATUSES,
  AWAITING_ORGANIZER_STATUSES,
  ORGANIZER_RESPONSE_WINDOW_HOURS,
  PaymentStatus,
  TaskAssignmentStatus,
} from './schemas/booking.schema';
import { CreateBookingDto } from './dto/create-booking.dto';
import { UpdateBookingDto } from './dto/update-booking.dto';
import { UpdateBookingStatusDto } from './dto/update-booking-status.dto';
import { CreateBookingTaskDto, UpdateBookingTaskDto } from './dto/booking-task.dto';
import { QuoteService } from '../quote/quote.service';
import { OrganizerService } from '../organizer/organizer.service';
import { SubvendorService } from '../subvendor/subvendor.service';
import { QuoteRequestStatus } from '../quote/schemas/quote-request.schema';
import { TIER_CONFIG, TIER_ORDER, computeEarnedTier } from '../organizer/tier-config';
import { NotificationService } from '../notification/notification.service';
import { NotificationType } from '../notification/schemas/notification.schema';
import {
  Invitation,
  InvitationDocument,
  InvitationStatus,
} from '../invitation/schemas/invitation.schema';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { Role } from '../../common/enums/role.enum';

/**
 * Shape consumed by the home "BOOKED" card (matches frontend BookedEventData).
 *
 * Built from any *live* booking — pending, confirmed or in progress. Pending is
 * included deliberately: a booking is created the moment the customer accepts a
 * quote and pays, but only the organizer can move it to confirmed, so excluding
 * pending meant the customer saw no booked event at all in the window between
 * their own payment and the organizer getting around to confirming.
 *
 * `status` travels with it so the badge and the copy can be honest about which
 * of those three it is, rather than implying the organizer has confirmed.
 */
export interface ActiveBookingView {
  id: string;
  ref: string;
  title: string;
  description: string;
  progress: number;
  daysToGo: number;
  status: BookingStatus;
  /** Whether the organizer has confirmed — drives the card's sub-line. */
  organizerConfirmed: boolean;
  organizerName: string;
  steps: { label: string; done: boolean }[];
}

/** Organizer identity attached to a booking summary. */
export interface BookingOrganizerRef {
  id: string;
  name: string;
  initials: string;
  avatarColor: string;
  tier: string;
  rating: number;
}

/**
 * Latest live booking summary consumed by the Home "Current Event" resolver.
 *
 * Deliberately no longer extends ActiveBookingView: that shape is now composed
 * for the booked card specifically (derived title, status-aware copy, computed
 * milestones), while this one reports the booking's own stored fields. Sharing a
 * base type meant a change made for one silently altered the other.
 */
export interface LatestBookingSummary {
  id: string;
  ref: string;
  title: string;
  description: string;
  progress: number;
  daysToGo: number;
  steps: { label: string; done: boolean }[];
  status: BookingStatus;
  organizer: BookingOrganizerRef | null;
  createdAt: Date | undefined;
  updatedAt: Date | undefined;
}

const STATUS_META: Record<BookingStatus, { label: string; progress: number }> = {
  [BookingStatus.PENDING]: {
    label: 'Booking placed',
    progress: 5,
  },
  [BookingStatus.AWAITING_ORGANIZER]: {
    label: 'Advance paid — awaiting organizer confirmation',
    progress: 20,
  },
  [BookingStatus.CONFIRMED]: { label: 'Organizer confirmed your booking', progress: 40 },
  [BookingStatus.IN_PROGRESS]: { label: 'Your event is now in progress', progress: 70 },
  [BookingStatus.COMPLETED]: { label: 'Event completed', progress: 100 },
  [BookingStatus.CANCELLED]: { label: 'Booking cancelled', progress: 0 },
  [BookingStatus.REJECTED]: { label: 'Organizer declined this booking', progress: 0 },
  [BookingStatus.EXPIRED]: {
    label: 'Organizer did not respond in time',
    progress: 0,
  },
};

const TERMINAL = [
  BookingStatus.COMPLETED,
  BookingStatus.CANCELLED,
  BookingStatus.REJECTED,
  BookingStatus.EXPIRED,
];

/**
 * The only transitions the API will make. Without this, `PATCH /booking/:id/status`
 * accepted any enum value from any live state — an organizer could jump a booking
 * straight from "awaiting confirmation" to "completed" without ever accepting it.
 */
const ALLOWED_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  [BookingStatus.PENDING]: [
    BookingStatus.AWAITING_ORGANIZER,
    BookingStatus.CONFIRMED,
    BookingStatus.REJECTED,
    BookingStatus.CANCELLED,
    BookingStatus.EXPIRED,
  ],
  [BookingStatus.AWAITING_ORGANIZER]: [
    BookingStatus.CONFIRMED,
    BookingStatus.REJECTED,
    BookingStatus.CANCELLED,
    BookingStatus.EXPIRED,
  ],
  [BookingStatus.CONFIRMED]: [
    BookingStatus.IN_PROGRESS,
    BookingStatus.COMPLETED,
    BookingStatus.CANCELLED,
  ],
  [BookingStatus.IN_PROGRESS]: [BookingStatus.COMPLETED, BookingStatus.CANCELLED],
  [BookingStatus.COMPLETED]: [],
  [BookingStatus.CANCELLED]: [],
  [BookingStatus.REJECTED]: [],
  [BookingStatus.EXPIRED]: [],
};

/** The customer-facing checklist, in order. Index maps to `STEP_ORDER` below. */
const BOOKING_STEPS = [
  'Booking placed',
  'Advance paid',
  'Organizer confirmed',
  'Event in progress',
  'Completed',
];

/** Which checklist index each status has reached. */
const STEP_ORDER: Partial<Record<BookingStatus, number>> = {
  [BookingStatus.PENDING]: 0,
  [BookingStatus.AWAITING_ORGANIZER]: 1,
  [BookingStatus.CONFIRMED]: 2,
  [BookingStatus.IN_PROGRESS]: 3,
  [BookingStatus.COMPLETED]: 4,
};

@Injectable()
export class BookingService {
  private readonly logger = new Logger(BookingService.name);

  constructor(
    @InjectModel(Booking.name) private readonly bookingModel: Model<BookingDocument>,
    /*
     * The invitation model, not InvitationModule: the invitation service already
     * depends on the booking schema, so importing the module here would be a
     * cycle. Only the approval status is read, and only for the home card.
     */
    @InjectModel(Invitation.name) private readonly invitationModel: Model<InvitationDocument>,
    private readonly quoteService: QuoteService,
    private readonly organizerService: OrganizerService,
    private readonly subvendorService: SubvendorService,
    private readonly notificationService: NotificationService,
  ) {}

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private toObjectId(id: string): Types.ObjectId {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Booking not found');
    return new Types.ObjectId(id);
  }

  private daysUntil(date: Date): number {
    const ms = date.getTime() - Date.now();
    return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
  }

  private static generateRef(): string {
    const year = new Date().getFullYear();
    const rand = Math.floor(1000 + Math.random() * 9000);
    return `EVT-${year}-${rand}`;
  }

  private async notifyUser(
    userId: Types.ObjectId | string | null | undefined,
    title: string,
    body: string,
    link = '/workspace',
  ): Promise<void> {
    if (!userId) return;
    try {
      await this.notificationService.create(
        userId.toString(),
        title,
        body,
        NotificationType.BOOKING,
        link,
      );
    } catch (err) {
      this.logger.warn(`Booking notification failed: ${String(err)}`);
    }
  }

  /** Notify the organizer's owning user (if the profile is linked to an account). */
  private async notifyOrganizer(
    organizerId: Types.ObjectId | undefined,
    title: string,
    body: string,
    link?: string,
  ): Promise<void> {
    if (!organizerId) return;
    try {
      const profile = await this.organizerService.findById(organizerId.toString());
      await this.notifyUser(profile.user, title, body, link);
    } catch (err) {
      this.logger.warn(`Organizer booking notification failed: ${String(err)}`);
    }
  }

  /** Notify the sub-vendor's owning user (if the profile still exists). */
  private async notifySubVendor(
    subVendorId: Types.ObjectId | undefined,
    title: string,
    body: string,
  ): Promise<void> {
    if (!subVendorId) return;
    try {
      const profile = await this.subvendorService.findById(subVendorId.toString());
      await this.notifyUser(profile.user, title, body, '/subvendor/home');
    } catch (err) {
      this.logger.warn(`Sub-vendor task notification failed: ${String(err)}`);
    }
  }

  private detailView(b: BookingDocument): Record<string, unknown> {
    const org = b.organizer as unknown as Record<string, unknown> | undefined;
    const organizer =
      org && typeof org === 'object' && 'name' in org
        ? {
            id: (org._id as Types.ObjectId).toString(),
            name: org.name,
            initials: org.initials,
            avatarColor: org.avatarColor,
            tier: org.tier,
            rating: org.rating,
          }
        : null;
    const cust = b.customer as unknown as Record<string, unknown> | undefined;
    const customer =
      cust && typeof cust === 'object' && 'name' in cust
        ? { id: (cust._id as Types.ObjectId).toString(), name: cust.name }
        : null;
    /*
     * Legacy rows predate the stored snapshot; they fall back to the old
     * hardcoded 30% so an existing booking still renders a sane split.
     */
    const advancePercentage = b.advancePercentage || 30;
    const advanceAmount = b.advanceAmount || Math.round((b.amount * advancePercentage) / 100);
    return {
      id: b._id.toString(),
      ref: b.ref,
      title: b.title,
      description: b.description,
      occasion: b.occasion,
      location: b.location,
      eventDate: b.eventDate,
      daysToGo: this.daysUntil(b.eventDate),
      amount: b.amount,
      advanceAmount,
      advancePercentage,
      balanceAmount: Math.max(0, b.amount - advanceAmount),
      paymentStatus: b.paymentStatus ?? PaymentStatus.UNPAID,
      amountPaid: b.amountPaid ?? 0,
      advancePaidAt: b.advancePaidAt ?? null,
      organizerRespondBy: b.organizerRespondBy ?? null,
      declineReason: b.declineReason ?? '',
      progress: b.progress,
      steps: b.steps,
      tasks: b.tasks.map((t) => ({
        id: (t as unknown as { _id: Types.ObjectId })._id.toString(),
        title: t.title,
        status: t.status,
        assigneeName: t.assigneeName,
        subVendorId: t.subVendorId ? t.subVendorId.toString() : null,
        assignmentStatus: t.assignmentStatus,
        amount: t.amount,
        dueDate: t.dueDate ?? null,
        photoProof: t.photoProof,
      })),
      timeline: b.timeline,
      status: b.status,
      organizer,
      customer,
      quotationId: b.quotation ? b.quotation.toString() : null,
      // The quote request this booking came from — the link My Events uses to
      // show the request, its responses and this booking as one event.
      requestId: b.request ? b.request.toString() : null,
      createdAt: b.createdAt,
      updatedAt: b.updatedAt,
    };
  }

  private async organizerProfileId(userId: string): Promise<Types.ObjectId> {
    const profile = await this.organizerService.findByUser(userId);
    if (!profile) {
      throw new ForbiddenException('No organizer profile is linked to your account');
    }
    return profile._id;
  }

  // ---------------------------------------------------------------------------
  // Home card (reused by the home module) — the customer's live booking
  // ---------------------------------------------------------------------------

  /** Statuses a customer would call "my booked event". */
  private static readonly LIVE_BOOKING_STATUSES = [
    BookingStatus.PENDING,
    BookingStatus.AWAITING_ORGANIZER,
    BookingStatus.CONFIRMED,
    BookingStatus.IN_PROGRESS,
  ];

  /** "28 Dec 2026" — the event date as the card titles it. */
  private static dateLabel(d: Date | undefined): string {
    if (!d) return '';
    const t = new Date(d);
    if (Number.isNaN(t.getTime())) return '';
    return t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  /**
   * The four milestones the home card shows, each resolved from real state — no
   * placeholder ticks:
   *
   *   Organizer booked   the booking exists at all (the customer chose and paid)
   *   Vendors locked     organizer confirmed AND every sub-vendor they assigned
   *                      has accepted (an assignment still pending is not locked)
   *   Invitation         the guest invitation has been approved by the customer
   *   Final walkthrough  delivery has started, i.e. the event is under way
   */
  private bookedMilestones(
    booking: BookingDocument,
    invitationApproved: boolean,
  ): { label: string; done: boolean }[] {
    const confirmed =
      booking.status === BookingStatus.CONFIRMED ||
      booking.status === BookingStatus.IN_PROGRESS ||
      booking.status === BookingStatus.COMPLETED;
    const assigned = (booking.tasks ?? []).filter((t) => t.subVendorId);
    const vendorsLocked =
      confirmed &&
      assigned.length > 0 &&
      assigned.every((t) => t.assignmentStatus === TaskAssignmentStatus.ACCEPTED);
    const underway =
      booking.status === BookingStatus.IN_PROGRESS || booking.status === BookingStatus.COMPLETED;

    return [
      { label: 'Organizer booked', done: true },
      { label: 'Vendors locked', done: vendorsLocked },
      { label: 'Invitation', done: invitationApproved },
      { label: 'Final walkthrough', done: underway },
    ];
  }

  async getActiveForUser(userId: string): Promise<ActiveBookingView | null> {
    const booking = await this.bookingModel
      .findOne({
        customer: new Types.ObjectId(userId),
        status: { $in: BookingService.LIVE_BOOKING_STATUSES },
      })
      .populate('organizer', 'name')
      .sort({ createdAt: -1 })
      .exec();
    if (!booking) return null;

    const org = booking.organizer as unknown as { name?: string } | null;
    const organizerName =
      org && typeof org === 'object' && typeof org.name === 'string' && org.name.trim()
        ? org.name.trim()
        : 'Your organizer';

    const invitation = await this.invitationModel
      .findOne({ booking: booking._id }, { status: 1 })
      .lean()
      .exec();
    // Compared against the enum rather than a bare string: this is the only
    // read of invitation status outside the invitation module, so a rename
    // there should fail the build here instead of silently never ticking.
    const invitationApproved = invitation?.status === InvitationStatus.APPROVED;

    const steps = this.bookedMilestones(booking, invitationApproved);
    const confirmed = !(AWAITING_ORGANIZER_STATUSES as BookingStatus[]).includes(booking.status);

    const occasion = (booking.occasion ?? '').trim();
    const date = BookingService.dateLabel(booking.eventDate);
    const title = [`Your ${occasion || 'event'}`, date].filter(Boolean).join(' · ');

    /*
     * The sub-line says who is running the event and what is outstanding. Until
     * the organizer confirms, saying they are "managing every vendor" would be
     * untrue — the booking is paid for but not yet accepted on their side.
     */
    const description = !confirmed
      ? `${organizerName} has your booking and will confirm it shortly. Review the plan and track progress in one workspace.`
      : booking.status === BookingStatus.IN_PROGRESS
        ? `${organizerName} is running your event today. Follow the timeline and approvals in one workspace.`
        : `${organizerName} is managing every vendor. Review the plan, approve your invitation, and track progress — all in one workspace.`;

    return {
      id: booking._id.toString(),
      ref: booking.ref,
      title,
      description,
      /*
       * Derived from the milestones above rather than the status-stepped
       * `booking.progress`, so the ring and the ticks under it can never
       * disagree — a card reading "82% ready" with nothing ticked is a bug the
       * customer can see.
       */
      progress: Math.round((steps.filter((s) => s.done).length / steps.length) * 100),
      daysToGo: this.daysUntil(booking.eventDate),
      status: booking.status,
      organizerConfirmed: confirmed,
      organizerName,
      steps,
    };
  }

  /**
   * Latest *live* booking for the Home "Current Event" resolver — any non-
   * terminal status (pending → confirmed → in_progress → completed), so the
   * card can follow the booking from creation through delivery. Terminal
   * bookings (completed, cancelled, rejected) are excluded so the Home widget
   * only reflects *live* events — completed events live in My Events history.
   * Returns null when there is none.
   *
   * Reuses the bookings collection consumed by the workspace — no duplicated data.
   */
  async getLatestForUser(userId: string): Promise<LatestBookingSummary | null> {
    const booking = await this.bookingModel
      .findOne({
        customer: new Types.ObjectId(userId),
        status: {
          $nin: [BookingStatus.CANCELLED, BookingStatus.REJECTED, BookingStatus.COMPLETED],
        },
      })
      .populate('organizer', 'name initials avatarColor tier rating')
      .sort({ createdAt: -1 })
      .exec();
    if (!booking) return null;

    const org = booking.organizer as unknown as Record<string, unknown> | undefined;
    const organizer =
      org && typeof org === 'object' && 'name' in org
        ? {
            id: (org._id as Types.ObjectId).toString(),
            name: String(org.name ?? ''),
            initials: String(org.initials ?? ''),
            avatarColor: String(org.avatarColor ?? ''),
            tier: String(org.tier ?? ''),
            rating: typeof org.rating === 'number' ? org.rating : 0,
          }
        : null;

    return {
      id: booking._id.toString(),
      ref: booking.ref,
      title: booking.title,
      description: booking.description,
      progress: booking.progress,
      daysToGo: this.daysUntil(booking.eventDate),
      steps: booking.steps,
      status: booking.status,
      organizer,
      createdAt: booking.createdAt,
      updatedAt: booking.updatedAt,
    };
  }

  /**
   * True when a booking already exists for the given quote request (any status).
   * Lets the Home resolver treat an accepted quote whose booking was already
   * created — including one that later completed — as no longer "current".
   */
  async existsForRequest(userId: string, requestId: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(requestId)) return false;
    const count = await this.bookingModel
      .countDocuments({
        customer: new Types.ObjectId(userId),
        request: new Types.ObjectId(requestId),
      })
      .exec();
    return count > 0;
  }

  // ---------------------------------------------------------------------------
  // Customer — create / read
  // ---------------------------------------------------------------------------

  /** Create a booking from an accepted quotation. Idempotent per quotation. */
  async createFromQuotation(
    userId: string,
    dto: CreateBookingDto,
  ): Promise<Record<string, unknown>> {
    const seed = await this.quoteService.getBookingSeed(userId, dto.quotationId);

    // Idempotency: one booking per quotation.
    const existing = await this.bookingModel
      .findOne({ quotation: this.toObjectId(dto.quotationId) })
      .populate('organizer', 'name initials avatarColor tier rating')
      .exec();
    if (existing) return this.detailView(existing);

    const eventDate = this.deriveEventDate(seed.when);
    const title = seed.occasion
      ? `${seed.occasion}${seed.when ? ` · ${seed.when}` : ''}`
      : 'Your event';

    const placedAt = new Date();
    const respondBy = new Date(
      placedAt.getTime() + ORGANIZER_RESPONSE_WINDOW_HOURS * 60 * 60 * 1000,
    );

    const created = await this.bookingModel.create({
      customer: new Types.ObjectId(seed.customerId),
      organizer: seed.organizerId ? new Types.ObjectId(seed.organizerId) : undefined,
      quotation: new Types.ObjectId(seed.quotationId),
      request: seed.requestId ? new Types.ObjectId(seed.requestId) : undefined,
      ref: BookingService.generateRef(),
      title,
      occasion: seed.occasion,
      location: seed.where,
      description: `${seed.occasion || 'Event'} for ${seed.guests || 'your guests'}.`.trim(),
      eventDate,
      amount: seed.amount,
      /*
       * Creating the booking IS the advance payment in this flow — the customer
       * reaches `POST /booking` only from checkout's "Confirm & Pay". So the
       * payment axis is settled here, and the booking axis moves to
       * AWAITING_ORGANIZER: paid, but not yet accepted by anyone.
       */
      advancePercentage: seed.advancePercentage,
      advanceAmount: seed.advanceAmount,
      amountPaid: seed.advanceAmount,
      paymentStatus: PaymentStatus.ADVANCE_PAID,
      advancePaidAt: placedAt,
      organizerRespondBy: respondBy,
      progress: STATUS_META[BookingStatus.AWAITING_ORGANIZER].progress,
      status: BookingStatus.AWAITING_ORGANIZER,
      steps: BOOKING_STEPS.map((label, i) => ({ label, done: i <= 1 })),
      timeline: [
        {
          status: BookingStatus.PENDING,
          label: STATUS_META[BookingStatus.PENDING].label,
          at: placedAt,
        },
        {
          status: BookingStatus.AWAITING_ORGANIZER,
          label: STATUS_META[BookingStatus.AWAITING_ORGANIZER].label,
          note: `Advance of ₹${seed.advanceAmount.toLocaleString('en-IN')} received.`,
          at: placedAt,
        },
      ],
    });

    await this.notifyUser(
      created.customer,
      'Advance paid — awaiting organizer 🎉',
      `We received your advance for ${created.ref}. Your organizer has ${ORGANIZER_RESPONSE_WINDOW_HOURS}h to confirm.`,
      `/booking-details/${created._id.toString()}`,
    );
    await this.notifyOrganizer(
      created.organizer,
      'New booking to confirm',
      `A customer paid the advance for their ${seed.occasion || 'event'} (${created.ref}). Accept or decline within ${ORGANIZER_RESPONSE_WINDOW_HOURS}h.`,
      `/organizer/events/${created._id.toString()}`,
    );

    const populated = await created.populate('organizer', 'name initials avatarColor tier rating');
    return this.detailView(populated);
  }

  /**
   * `when` is whatever the customer typed/picked on the request — the real
   * Plan wizard sends a full date (e.g. "2026-12-20"), while older/seed data
   * used a bare day-month label (e.g. "28 Dec"). Try the full date first,
   * then fall back to appending the current year for the short form.
   */
  private deriveEventDate(when: string): Date {
    if (when) {
      const direct = new Date(when);
      if (!Number.isNaN(direct.getTime()) && direct.getTime() > Date.now()) return direct;

      const withYear = new Date(`${when} ${new Date().getFullYear()}`);
      if (!Number.isNaN(withYear.getTime()) && withYear.getTime() > Date.now()) return withYear;
    }
    // Fallback: 30 days out, so daysToGo is sensible when 'when' isn't parseable.
    return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  }

  /** All of the customer's bookings, newest first (history). */
  async findMine(userId: string): Promise<Record<string, unknown>[]> {
    const bookings = await this.bookingModel
      .find({ customer: new Types.ObjectId(userId) })
      .populate('organizer', 'name initials avatarColor tier rating')
      .sort({ createdAt: -1 })
      .exec();
    await Promise.all(bookings.map((b) => this.expireIfOverdue(b)));
    return bookings.map((b) => this.detailView(b));
  }

  // ---------------------------------------------------------------------------
  // Organizer — read / execution board / dashboard / calendar
  // ---------------------------------------------------------------------------

  /** All bookings for the organizer's own profile, newest event first. */
  async findForOrganizer(userId: string): Promise<Record<string, unknown>[]> {
    const profileId = await this.organizerProfileId(userId);
    const bookings = await this.bookingModel
      .find({ organizer: profileId })
      .populate('customer', 'name')
      .sort({ eventDate: 1 })
      .exec();
    await Promise.all(bookings.map((b) => this.expireIfOverdue(b)));
    return bookings.map((b) => this.detailView(b));
  }

  /** Home dashboard: real stats + today's tasks + the week ahead + new enquiries. */
  async getDashboard(userId: string): Promise<Record<string, unknown>> {
    const profileId = await this.organizerProfileId(userId);
    const [profile, bookings, incoming] = await Promise.all([
      this.organizerService.findById(profileId.toString()),
      this.bookingModel.find({ organizer: profileId }).populate('customer', 'name').exec(),
      this.quoteService.listIncoming(userId),
    ]);

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfToday = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000);

    const activeBookings = bookings.filter((b) =>
      (ONGOING_BOOKING_STATUSES as BookingStatus[]).includes(b.status),
    );
    const earningsBetween = (start: Date, end: Date): number =>
      bookings
        .filter(
          (b) =>
            b.status !== BookingStatus.CANCELLED &&
            b.status !== BookingStatus.REJECTED &&
            b.createdAt &&
            b.createdAt >= start &&
            b.createdAt < end,
        )
        .reduce((sum, b) => sum + b.amount, 0);

    // Bucketed by when the booking was made (createdAt), not the event date —
    // events are often booked months ahead, so an eventDate-based "this
    // month" would rarely match the deal actually closing this month.
    const monthEarnings = earningsBetween(monthStart, nextMonthStart);
    const lastMonthEarnings = earningsBetween(lastMonthStart, monthStart);
    const monthEarningsChangePercent =
      lastMonthEarnings > 0
        ? Math.round(((monthEarnings - lastMonthEarnings) / lastMonthEarnings) * 100)
        : null;

    const todaysTasks = bookings.flatMap((b) =>
      b.tasks
        .filter((t) => t.dueDate && t.dueDate >= startOfToday && t.dueDate < endOfToday)
        .map((t) => ({
          id: (t as unknown as { _id: Types.ObjectId })._id.toString(),
          bookingId: b._id.toString(),
          title: t.title,
          status: t.status,
        })),
    );

    const next7Days = bookings
      .filter(
        (b) =>
          b.eventDate >= startOfToday &&
          b.eventDate <= in7Days &&
          b.status !== BookingStatus.CANCELLED &&
          b.status !== BookingStatus.REJECTED,
      )
      .map((b) => {
        const cust = b.customer as unknown as Record<string, unknown> | undefined;
        return {
          id: b._id.toString(),
          eventDate: b.eventDate,
          title: b.title,
          customerName: cust && 'name' in cust ? String(cust.name ?? '') : '',
        };
      });

    const pendingEnquiries = incoming
      .filter(
        (r) =>
          !r.myQuotation &&
          r.status !== QuoteRequestStatus.CANCELLED &&
          r.status !== QuoteRequestStatus.CLOSED,
      )
      .slice(0, 5);

    return {
      newEnquiries: pendingEnquiries.length,
      activeBookings: activeBookings.length,
      monthEarnings,
      monthEarningsChangePercent,
      avgRating: profile.rating,
      todaysTasks,
      next7Days,
      pendingEnquiries,
    };
  }

  /** Bookings + blocked dates for the calendar, this organizer's own view. */
  async getCalendar(userId: string): Promise<Record<string, unknown>> {
    const profileId = await this.organizerProfileId(userId);
    const [profile, bookings] = await Promise.all([
      this.organizerService.findById(profileId.toString()),
      this.bookingModel
        .find({
          organizer: profileId,
          status: { $nin: [BookingStatus.CANCELLED, BookingStatus.REJECTED] },
        })
        .populate('customer', 'name')
        .exec(),
    ]);

    const bookedDates = bookings.map((b) => {
      const cust = b.customer as unknown as Record<string, unknown> | undefined;
      return {
        date: b.eventDate,
        bookingId: b._id.toString(),
        title: b.title,
        customerName: cust && 'name' in cust ? String(cust.name ?? '') : '',
        // Venue, so the calendar's day panel can say where the event is
        // without refetching the whole booking.
        location: b.location,
        amount: b.amount,
        status: b.status,
      };
    });

    return {
      bookedDates,
      blockedDates: profile.busyDates,
    };
  }

  /** Organizer's sub-vendor list enriched with real per-organizer task stats. */
  async getSubVendorsForOrganizer(userId: string): Promise<Record<string, unknown>[]> {
    const orgId = await this.organizerProfileId(userId);
    const links = await this.subvendorService.listForOrganizer(userId);
    const svIds = links
      .map((l) => (l as { subVendor: { id: string } | null }).subVendor?.id)
      .filter((id): id is string => !!id)
      .map((id) => new Types.ObjectId(id));
    if (!svIds.length) return links.map((l) => ({ ...l, eventsCount: 0, performancePercent: 0 }));

    const bookings = await this.bookingModel
      .find({ organizer: orgId, 'tasks.subVendorId': { $in: svIds } })
      .exec();

    const statsBySv = new Map<string, { accepted: number; done: number }>();
    bookings.forEach((b) => {
      b.tasks.forEach((t) => {
        if (!t.subVendorId || t.assignmentStatus !== TaskAssignmentStatus.ACCEPTED) return;
        const key = t.subVendorId.toString();
        const entry = statsBySv.get(key) ?? { accepted: 0, done: 0 };
        entry.accepted += 1;
        if (t.status === BookingTaskStatus.DONE) entry.done += 1;
        statsBySv.set(key, entry);
      });
    });

    return links.map((l) => {
      const svId = (l as { subVendor: { id: string } | null }).subVendor?.id;
      const stats = svId ? statsBySv.get(svId) : undefined;
      return {
        ...l,
        eventsCount: stats?.done ?? 0,
        performancePercent:
          stats && stats.accepted ? Math.round((stats.done / stats.accepted) * 100) : 0,
      };
    });
  }

  /** Toggle a manually-blocked date on the organizer's own calendar. */
  async setDateBlocked(userId: string, date: Date, blocked: boolean): Promise<string[]> {
    const profileId = await this.organizerProfileId(userId);
    const profile = await this.organizerService.findById(profileId.toString());
    const day = date.toISOString().slice(0, 10);
    const already = (profile.busyDates ?? []).some(
      (d) => new Date(d).toISOString().slice(0, 10) === day,
    );

    if (blocked && !already) {
      profile.busyDates = [...(profile.busyDates ?? []), date];
    } else if (!blocked && already) {
      profile.busyDates = (profile.busyDates ?? []).filter(
        (d) => new Date(d).toISOString().slice(0, 10) !== day,
      );
    }
    await profile.save();
    return profile.busyDates.map((d) => new Date(d).toISOString().slice(0, 10));
  }

  /**
   * Badges & tiers — live-computed from real bookings/profile data (events
   * count is *always* counted fresh here rather than trusting a stored
   * counter, since nothing else in the codebase increments one). Auto-
   * promotes the stored tier when requirements are newly met, so the
   * (already customer-facing) tier badge reflects real progress.
   */
  async getBadgeStatus(userId: string): Promise<Record<string, unknown>> {
    const profileId = await this.organizerProfileId(userId);
    const profile = await this.organizerService.findById(profileId.toString());
    const events = await this.bookingModel.countDocuments({
      organizer: profileId,
      status: BookingStatus.COMPLETED,
    });

    const stats = {
      events,
      avgRating: profile.rating,
      trainingStage: profile.trainingStage,
      complaints: profile.complaintsCount,
    };
    const earned = computeEarnedTier(stats);
    if (TIER_ORDER.indexOf(earned) > TIER_ORDER.indexOf(profile.tier)) {
      profile.tier = earned;
      await profile.save();
    }

    const current = TIER_CONFIG[profile.tier];
    const next = current.next ? TIER_CONFIG[current.next] : null;

    return {
      currentTier: profile.tier,
      commissionRate: current.commissionRate,
      events,
      avgRating: profile.rating,
      trainingStage: profile.trainingStage,
      complaintsCount: profile.complaintsCount,
      nextTier: next?.tier ?? null,
      nextRequirements: next?.requirements ?? null,
      tierLadder: TIER_ORDER.map((t) => ({
        tier: t,
        commissionRate: TIER_CONFIG[t].commissionRate,
      })),
    };
  }

  /** Earnings dashboard — totals, monthly trend, event mix, and a transaction ledger. */
  async getEarnings(userId: string): Promise<Record<string, unknown>> {
    const profileId = await this.organizerProfileId(userId);
    const [profile, bookings] = await Promise.all([
      this.organizerService.findById(profileId.toString()),
      this.bookingModel
        .find({
          organizer: profileId,
          status: {
            $in: [BookingStatus.CONFIRMED, BookingStatus.IN_PROGRESS, BookingStatus.COMPLETED],
          },
        })
        .populate('customer', 'name')
        .sort({ eventDate: -1 })
        .exec(),
    ]);

    const rate = TIER_CONFIG[profile.tier].commissionRate;
    const totalEarned = bookings.reduce((sum, b) => sum + b.amount, 0);
    const commission = Math.round(totalEarned * rate);
    const netPayout = totalEarned - commission;
    const paidNet = bookings
      .filter((b) => b.status === BookingStatus.COMPLETED)
      .reduce((sum, b) => sum + Math.round(b.amount * (1 - rate)), 0);
    const pendingPayout = netPayout - paidNet;

    // Monthly trend: this month and the 5 before it.
    const now = new Date();
    const months = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
    // Bucketed by createdAt (when the deal closed) — see monthEarnings note
    // in getDashboard for why eventDate would misrepresent the trend.
    const monthlyEarnings = months.map(({ year, month }) => {
      const start = new Date(year, month, 1);
      const end = new Date(year, month + 1, 1);
      const total = bookings
        .filter((b) => b.createdAt && b.createdAt >= start && b.createdAt < end)
        .reduce((sum, b) => sum + b.amount, 0);
      return { label: start.toLocaleDateString('en-GB', { month: 'short' }), amount: total };
    });

    // Event mix by occasion, % of booking count.
    const mixCounts = new Map<string, number>();
    bookings.forEach((b) => {
      const key = b.occasion || 'Other';
      mixCounts.set(key, (mixCounts.get(key) ?? 0) + 1);
    });
    const eventMix = Array.from(mixCounts.entries()).map(([occasion, count]) => ({
      occasion,
      percent: bookings.length ? Math.round((count / bookings.length) * 100) : 0,
    }));

    const transactions = bookings.map((b) => {
      const cust = b.customer as unknown as Record<string, unknown> | undefined;
      const net = Math.round(b.amount * (1 - rate));
      return {
        id: b._id.toString(),
        ref: b.ref,
        customerName: cust && 'name' in cust ? String(cust.name ?? '') : '',
        eventDate: b.eventDate,
        amount: b.amount,
        commission: b.amount - net,
        net,
        payoutStatus: b.status === BookingStatus.COMPLETED ? 'paid' : 'pending',
      };
    });

    return {
      totalEarned,
      commission,
      netPayout,
      pendingPayout,
      commissionRate: rate,
      monthlyEarnings,
      eventMix,
      transactions,
    };
  }

  // ---------------------------------------------------------------------------
  // Organizer — execution tasks
  // ---------------------------------------------------------------------------

  private async loadOwnedBooking(userId: string, bookingId: string): Promise<BookingDocument> {
    const profileId = await this.organizerProfileId(userId);
    const booking = await this.bookingModel
      .findOne({ _id: this.toObjectId(bookingId), organizer: profileId })
      .exec();
    if (!booking) throw new NotFoundException('Booking not found');
    return booking;
  }

  async addTask(
    userId: string,
    bookingId: string,
    dto: CreateBookingTaskDto,
  ): Promise<Record<string, unknown>> {
    const profileId = await this.organizerProfileId(userId);
    const booking = await this.loadOwnedBooking(userId, bookingId);

    let assigneeName = dto.assigneeName ?? '';
    let subVendorId: Types.ObjectId | undefined;
    let assignmentStatus = TaskAssignmentStatus.UNASSIGNED;
    if (dto.subVendorId) {
      const sv = await this.subvendorService.assertLinked(profileId, dto.subVendorId);
      subVendorId = sv._id;
      assigneeName = sv.fullName;
      assignmentStatus = TaskAssignmentStatus.PENDING;
    }

    booking.tasks.push({
      title: dto.title,
      status: BookingTaskStatus.TODO,
      assigneeName,
      subVendorId,
      assignmentStatus,
      amount: dto.amount ?? 0,
      dueDate: dto.dueDate,
      photoProof: null,
    } as BookingDocument['tasks'][number]);
    await booking.save();

    if (subVendorId) {
      await this.notifySubVendor(
        subVendorId,
        'New task from an organizer',
        `You've been assigned "${dto.title}" for ${booking.title}. Accept or decline it.`,
      );
    }
    return this.detailView(booking);
  }

  async updateTask(
    userId: string,
    bookingId: string,
    taskId: string,
    dto: UpdateBookingTaskDto,
  ): Promise<Record<string, unknown>> {
    const profileId = await this.organizerProfileId(userId);
    const booking = await this.loadOwnedBooking(userId, bookingId);
    const task = booking.tasks.find(
      (t) => (t as unknown as { _id: Types.ObjectId })._id.toString() === taskId,
    );
    if (!task) throw new NotFoundException('Task not found');
    if (dto.title !== undefined) task.title = dto.title;
    if (dto.status !== undefined) task.status = dto.status;
    if (dto.dueDate !== undefined) task.dueDate = dto.dueDate;
    if (dto.amount !== undefined) task.amount = dto.amount;
    if (dto.photoProof !== undefined) {
      task.photoProof = {
        url: dto.photoProof.url,
        key: dto.photoProof.key,
        originalName: dto.photoProof.originalName ?? '',
      };
    }

    let newlyAssigned: Types.ObjectId | undefined;
    if (dto.subVendorId !== undefined) {
      if (dto.subVendorId === null) {
        task.subVendorId = undefined;
        task.assignmentStatus = TaskAssignmentStatus.UNASSIGNED;
        if (dto.assigneeName === undefined) task.assigneeName = '';
      } else {
        const sv = await this.subvendorService.assertLinked(profileId, dto.subVendorId);
        task.subVendorId = sv._id;
        task.assigneeName = sv.fullName;
        task.assignmentStatus = TaskAssignmentStatus.PENDING;
        newlyAssigned = sv._id;
      }
    } else if (dto.assigneeName !== undefined) {
      task.assigneeName = dto.assigneeName;
    }

    await booking.save();

    if (newlyAssigned) {
      await this.notifySubVendor(
        newlyAssigned,
        'New task from an organizer',
        `You've been assigned "${task.title}" for ${booking.title}. Accept or decline it.`,
      );
    }
    return this.detailView(booking);
  }

  async removeTask(
    userId: string,
    bookingId: string,
    taskId: string,
  ): Promise<Record<string, unknown>> {
    const booking = await this.loadOwnedBooking(userId, bookingId);
    booking.tasks = booking.tasks.filter(
      (t) => (t as unknown as { _id: Types.ObjectId })._id.toString() !== taskId,
    ) as BookingDocument['tasks'];
    await booking.save();
    return this.detailView(booking);
  }

  // ---------------------------------------------------------------------------
  // Sub-vendor — my tasks / accept-decline / status updates
  // ---------------------------------------------------------------------------

  private async subVendorProfileId(userId: string): Promise<Types.ObjectId> {
    const profile = await this.subvendorService.findByUser(userId);
    if (!profile) throw new ForbiddenException('No sub-vendor profile is linked to your account');
    return profile._id;
  }

  /** Every task across all bookings assigned to this sub-vendor. */
  async findTasksForSubVendor(userId: string): Promise<Record<string, unknown>[]> {
    const svId = await this.subVendorProfileId(userId);
    const bookings = await this.bookingModel
      .find({ 'tasks.subVendorId': svId })
      .populate('organizer', 'name initials avatarColor')
      .exec();

    return bookings.flatMap((b) => {
      const org = b.organizer as unknown as Record<string, unknown> | undefined;
      const organizer =
        org && typeof org === 'object' && 'name' in org
          ? {
              id: (org._id as Types.ObjectId).toString(),
              name: String(org.name ?? ''),
              initials: String(org.initials ?? ''),
              avatarColor: String(org.avatarColor ?? ''),
            }
          : null;
      return b.tasks
        .filter((t) => t.subVendorId && t.subVendorId.toString() === svId.toString())
        .map((t) => ({
          id: (t as unknown as { _id: Types.ObjectId })._id.toString(),
          bookingId: b._id.toString(),
          bookingRef: b.ref,
          bookingTitle: b.title,
          eventDate: b.eventDate,
          location: b.location,
          organizer,
          title: t.title,
          status: t.status,
          assignmentStatus: t.assignmentStatus,
          amount: t.amount,
          dueDate: t.dueDate ?? null,
          photoProof: t.photoProof,
        }));
    });
  }

  private findOwnTask(
    booking: BookingDocument,
    taskId: string,
    svId: Types.ObjectId,
  ): BookingDocument['tasks'][number] {
    const task = booking.tasks.find(
      (t) =>
        (t as unknown as { _id: Types.ObjectId })._id.toString() === taskId &&
        t.subVendorId &&
        t.subVendorId.toString() === svId.toString(),
    );
    if (!task) throw new NotFoundException('Task not found');
    return task;
  }

  /** Sub-vendor accepts or declines a pending task assignment. */
  async respondToTaskAssignment(
    userId: string,
    bookingId: string,
    taskId: string,
    accept: boolean,
  ): Promise<Record<string, unknown>> {
    const svId = await this.subVendorProfileId(userId);
    const booking = await this.bookingModel.findById(this.toObjectId(bookingId)).exec();
    if (!booking) throw new NotFoundException('Booking not found');
    const task = this.findOwnTask(booking, taskId, svId);

    task.assignmentStatus = accept ? TaskAssignmentStatus.ACCEPTED : TaskAssignmentStatus.DECLINED;
    await booking.save();

    await this.notifyOrganizer(
      booking.organizer,
      accept ? 'Sub-vendor accepted a task' : 'Sub-vendor declined a task',
      `${task.assigneeName} ${accept ? 'accepted' : 'declined'} "${task.title}" for ${booking.title}.`,
    );
    return this.detailView(booking);
  }

  /** Performance & payments (P-14) — real, derived from this sub-vendor's own task history. */
  async getSubVendorPerformance(userId: string): Promise<Record<string, unknown>> {
    const svId = await this.subVendorProfileId(userId);
    const bookings = await this.bookingModel
      .find({ 'tasks.subVendorId': svId })
      .populate('organizer', 'name')
      .exec();

    const accepted = bookings.flatMap((b) =>
      b.tasks
        .filter((t) => t.subVendorId?.toString() === svId.toString())
        .filter((t) => t.assignmentStatus === TaskAssignmentStatus.ACCEPTED)
        .map((t) => ({ task: t, booking: b })),
    );
    const done = accepted.filter((a) => a.task.status === BookingTaskStatus.DONE);
    const doneWithDueDate = done.filter((a) => a.task.dueDate);
    const onTime = doneWithDueDate.filter(
      (a) => a.task.updatedAt && a.task.dueDate && a.task.updatedAt <= a.task.dueDate,
    );

    const onTimeRate = doneWithDueDate.length
      ? (onTime.length / doneWithDueDate.length) * 100
      : 100;
    const completionRate = accepted.length ? (done.length / accepted.length) * 100 : 0;
    const photoProofRate = done.length
      ? (done.filter((a) => a.task.photoProof).length / done.length) * 100
      : 0;
    const avgRating = await this.subvendorService.avgRating(svId);
    const ratingPercent = avgRating * 20;
    const performanceScore = Math.round(
      (onTimeRate + completionRate + photoProofRate + ratingPercent) / 4,
    );

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const payments = accepted
      .filter((a) => a.task.amount > 0)
      .map((a) => {
        const org = a.booking.organizer as unknown as Record<string, unknown> | undefined;
        const status =
          a.task.status !== BookingTaskStatus.DONE
            ? 'pending'
            : a.booking.status === BookingStatus.COMPLETED
              ? 'paid'
              : 'processing';
        return {
          bookingId: a.booking._id.toString(),
          taskId: (a.task as unknown as { _id: Types.ObjectId })._id.toString(),
          event: a.booking.title,
          organizerName: org && 'name' in org ? String(org.name ?? '') : '',
          amount: a.task.amount,
          status,
          eventDate: a.booking.eventDate,
        };
      });

    const lifetimeEarned = payments.reduce((sum, p) => sum + p.amount, 0);
    const pendingPayout = payments
      .filter((p) => p.status !== 'paid')
      .reduce((sum, p) => sum + p.amount, 0);
    // Bucketed by when the task was assigned (createdAt) — see monthEarnings
    // note above for why the event date would misrepresent "this month".
    const thisMonthEarned = accepted
      .filter(
        (a) =>
          a.task.createdAt && a.task.createdAt >= monthStart && a.task.createdAt < nextMonthStart,
      )
      .reduce((sum, a) => sum + a.task.amount, 0);

    return {
      performanceScore,
      scoreBreakdown: {
        onTimeDeliveryRate: Math.round(onTimeRate),
        taskCompletionRate: Math.round(completionRate),
        photoProofSubmissionRate: Math.round(photoProofRate),
        avgOrganizerRating: Math.round(ratingPercent),
      },
      thisMonthEarned,
      pendingPayout,
      lifetimeEarned,
      payments: payments.sort((a, b) => b.eventDate.getTime() - a.eventDate.getTime()),
    };
  }

  /** Sub-vendor updates their own accepted task's status / photo proof. */
  async updateTaskAsSubVendor(
    userId: string,
    bookingId: string,
    taskId: string,
    dto: Pick<UpdateBookingTaskDto, 'status' | 'photoProof'>,
  ): Promise<Record<string, unknown>> {
    const svId = await this.subVendorProfileId(userId);
    const booking = await this.bookingModel.findById(this.toObjectId(bookingId)).exec();
    if (!booking) throw new NotFoundException('Booking not found');
    const task = this.findOwnTask(booking, taskId, svId);
    if (task.assignmentStatus !== TaskAssignmentStatus.ACCEPTED) {
      throw new ForbiddenException('Accept this task before updating it');
    }

    if (dto.status !== undefined) task.status = dto.status;
    if (dto.photoProof !== undefined) {
      task.photoProof = {
        url: dto.photoProof.url,
        key: dto.photoProof.key,
        originalName: dto.photoProof.originalName ?? '',
      };
    }
    await booking.save();
    return this.detailView(booking);
  }

  private async loadBooking(id: string): Promise<BookingDocument> {
    const booking = await this.bookingModel
      .findById(this.toObjectId(id))
      .populate('organizer', 'name initials avatarColor tier rating user')
      .exec();
    if (!booking) throw new NotFoundException('Booking not found');
    return booking;
  }

  /** A booking visible to its customer, the owning organizer, or an admin. */
  async findOne(actor: AuthUser, id: string): Promise<Record<string, unknown>> {
    const booking = await this.loadBooking(id);
    await this.assertCanView(booking, actor);
    await this.expireIfOverdue(booking);
    return this.detailView(booking);
  }

  // ---------------------------------------------------------------------------
  // Authorization
  // ---------------------------------------------------------------------------

  private isOwner(booking: BookingDocument, actor: AuthUser): boolean {
    return booking.customer.toString() === actor.userId;
  }

  private isAdmin(actor: AuthUser): boolean {
    return actor.roles?.includes(Role.ADMIN) ?? false;
  }

  private async isOwningOrganizer(booking: BookingDocument, actor: AuthUser): Promise<boolean> {
    if (!booking.organizer) return false;
    const org = booking.organizer as unknown as { _id?: Types.ObjectId; user?: Types.ObjectId };
    // organizer may be populated (has user) or a bare id — resolve the owning user.
    if (org.user) return org.user.toString() === actor.userId;
    const profile = await this.organizerService.findByUser(actor.userId);
    return !!profile && profile._id.toString() === booking.organizer.toString();
  }

  private async assertCanView(booking: BookingDocument, actor: AuthUser): Promise<void> {
    if (this.isOwner(booking, actor) || this.isAdmin(actor)) return;
    if (await this.isOwningOrganizer(booking, actor)) return;
    throw new ForbiddenException('You cannot access this booking');
  }

  // ---------------------------------------------------------------------------
  // Update / status transitions
  // ---------------------------------------------------------------------------

  async update(
    actor: AuthUser,
    id: string,
    dto: UpdateBookingDto,
  ): Promise<Record<string, unknown>> {
    const booking = await this.loadBooking(id);
    const canManage = this.isAdmin(actor) || (await this.isOwningOrganizer(booking, actor));
    if (!canManage && !this.isOwner(booking, actor)) {
      throw new ForbiddenException('You cannot edit this booking');
    }
    if (dto.description !== undefined) booking.description = dto.description;
    if (dto.eventDate !== undefined) booking.eventDate = dto.eventDate;
    if (dto.progress !== undefined) booking.progress = dto.progress;
    if (dto.steps !== undefined) booking.steps = dto.steps;
    await booking.save();
    return this.detailView(booking);
  }

  /** Transition a booking's status, enforcing who may make which change. */
  async updateStatus(
    actor: AuthUser,
    id: string,
    dto: UpdateBookingStatusDto,
  ): Promise<Record<string, unknown>> {
    const booking = await this.loadBooking(id);
    await this.expireIfOverdue(booking);

    if (TERMINAL.includes(booking.status)) {
      throw new ForbiddenException(`This booking is already ${booking.status}`);
    }

    const owner = this.isOwner(booking, actor);
    const manager = this.isAdmin(actor) || (await this.isOwningOrganizer(booking, actor));

    if (dto.status === BookingStatus.CANCELLED) {
      // Either party may cancel while the booking is still cancellable.
      if (!owner && !manager) throw new ForbiddenException('You cannot cancel this booking');
    } else {
      // Confirm / decline / progress / complete are organizer/admin actions.
      if (!manager) throw new ForbiddenException('Only the organizer can update this booking');
    }

    if (!ALLOWED_TRANSITIONS[booking.status].includes(dto.status)) {
      throw new ForbiddenException(`A ${booking.status} booking cannot move to ${dto.status}`);
    }

    const meta = STATUS_META[dto.status];
    booking.status = dto.status;
    // A decline keeps the organizer's reason on the booking so the customer
    // sees why, not just that it happened.
    if (dto.status === BookingStatus.REJECTED) {
      booking.declineReason = dto.note?.trim() ?? '';
    }
    if (meta.progress > 0 || dto.status === BookingStatus.COMPLETED) {
      booking.progress = meta.progress;
    }
    // Confirming closes the response window — nothing left to expire.
    if (dto.status === BookingStatus.CONFIRMED) {
      booking.organizerRespondBy = undefined;
    }
    booking.timeline.push({
      status: dto.status,
      label: meta.label,
      note: dto.note ?? '',
      at: new Date(),
    });
    this.syncSteps(booking);
    await booking.save();

    await this.emitTransitionNotifications(booking, dto.status);
    return this.detailView(booking);
  }

  /**
   * Lapse a booking the organizer never answered. There is no scheduler in this
   * service, so the deadline is enforced the moment anyone reads the booking —
   * which is the only time the state actually matters to someone.
   */
  private async expireIfOverdue(booking: BookingDocument): Promise<boolean> {
    if (!(AWAITING_ORGANIZER_STATUSES as BookingStatus[]).includes(booking.status)) return false;
    if (!booking.organizerRespondBy || booking.organizerRespondBy.getTime() > Date.now()) {
      return false;
    }
    booking.status = BookingStatus.EXPIRED;
    booking.progress = STATUS_META[BookingStatus.EXPIRED].progress;
    booking.timeline.push({
      status: BookingStatus.EXPIRED,
      label: STATUS_META[BookingStatus.EXPIRED].label,
      note: 'The organizer did not accept or decline inside the response window.',
      at: new Date(),
    });
    await booking.save();
    await this.notifyUser(
      booking.customer,
      'Organizer did not respond',
      `Booking ${booking.ref} expired because the organizer did not confirm in time. Your advance is eligible for a refund.`,
      `/booking-details/${booking._id.toString()}`,
    );
    return true;
  }

  /** Marks the checklist steps done up to the current status. */
  private syncSteps(booking: BookingDocument): void {
    const reached = STEP_ORDER[booking.status];
    // Cancelled / declined / expired never advance the checklist.
    if (reached === undefined) return;
    // Older bookings were created with the pre-payment four-step checklist;
    // rebuild against the canonical list so indexes and labels always agree.
    const steps =
      booking.steps.length === BOOKING_STEPS.length
        ? booking.steps
        : BOOKING_STEPS.map((label) => ({ label, done: false }));
    booking.steps = steps.map((s, i) => ({ ...s, done: i <= reached }));
  }

  private async emitTransitionNotifications(
    booking: BookingDocument,
    status: BookingStatus,
  ): Promise<void> {
    const ref = booking.ref;
    switch (status) {
      case BookingStatus.CONFIRMED:
        await this.notifyUser(
          booking.customer,
          'Organizer confirmed',
          `Your organizer confirmed booking ${ref}. Your event is locked in.`,
          `/booking-details/${booking._id.toString()}`,
        );
        break;
      case BookingStatus.IN_PROGRESS:
        await this.notifyUser(
          booking.customer,
          'Event in progress',
          `Booking ${ref} is now in progress.`,
        );
        break;
      case BookingStatus.COMPLETED:
        await this.notifyUser(
          booking.customer,
          'Event completed 🎉',
          `Booking ${ref} is complete. We hope it was wonderful!`,
        );
        await this.notifyOrganizer(
          booking.organizer,
          'Event completed',
          `Booking ${ref} is marked complete.`,
        );
        break;
      case BookingStatus.CANCELLED:
        await this.notifyUser(
          booking.customer,
          'Booking cancelled',
          `Booking ${ref} has been cancelled.`,
        );
        await this.notifyOrganizer(
          booking.organizer,
          'Booking cancelled',
          `Booking ${ref} has been cancelled.`,
        );
        break;
      case BookingStatus.REJECTED:
        await this.notifyUser(
          booking.customer,
          'Organizer declined your booking',
          booking.declineReason
            ? `Booking ${ref} was declined: ${booking.declineReason}`
            : `Booking ${ref} was declined by the organizer.`,
          `/booking-details/${booking._id.toString()}`,
        );
        break;
      default:
        break;
    }
  }

  /** Hard-delete a booking the customer owns (only while pending/cancelled/rejected). */
  async remove(userId: string, id: string): Promise<void> {
    const booking = await this.bookingModel
      .findOne({ _id: this.toObjectId(id), customer: new Types.ObjectId(userId) })
      .exec();
    if (!booking) throw new NotFoundException('Booking not found');
    if (
      ![
        BookingStatus.PENDING,
        BookingStatus.CANCELLED,
        BookingStatus.REJECTED,
        BookingStatus.EXPIRED,
      ].includes(booking.status)
    ) {
      throw new ForbiddenException('Only a pending or closed booking can be deleted');
    }
    await booking.deleteOne();
  }
}
