import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Booking,
  BookingDocument,
  BookingStatus,
  ONGOING_BOOKING_STATUSES,
} from './schemas/booking.schema';
import { CreateBookingDto } from './dto/create-booking.dto';
import { UpdateBookingDto } from './dto/update-booking.dto';
import { UpdateBookingStatusDto } from './dto/update-booking-status.dto';
import { QuoteService } from '../quote/quote.service';
import { OrganizerService } from '../organizer/organizer.service';
import { NotificationService } from '../notification/notification.service';
import { NotificationType } from '../notification/schemas/notification.schema';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { Role } from '../../common/enums/role.enum';

/** Shape consumed by the home "BOOKED" card (matches frontend BookedEventData). */
export interface ActiveBookingView {
  id: string;
  ref: string;
  title: string;
  description: string;
  progress: number;
  daysToGo: number;
  steps: { label: string; done: boolean }[];
}

const STATUS_META: Record<BookingStatus, { label: string; progress: number }> = {
  [BookingStatus.PENDING]: {
    label: 'Booking placed — awaiting organizer confirmation',
    progress: 10,
  },
  [BookingStatus.CONFIRMED]: { label: 'Organizer confirmed your booking', progress: 40 },
  [BookingStatus.IN_PROGRESS]: { label: 'Your event is now in progress', progress: 70 },
  [BookingStatus.COMPLETED]: { label: 'Event completed', progress: 100 },
  [BookingStatus.CANCELLED]: { label: 'Booking cancelled', progress: 0 },
  [BookingStatus.REJECTED]: { label: 'Organizer could not take this booking', progress: 0 },
};

const TERMINAL = [BookingStatus.COMPLETED, BookingStatus.CANCELLED, BookingStatus.REJECTED];

@Injectable()
export class BookingService {
  private readonly logger = new Logger(BookingService.name);

  constructor(
    @InjectModel(Booking.name) private readonly bookingModel: Model<BookingDocument>,
    private readonly quoteService: QuoteService,
    private readonly organizerService: OrganizerService,
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
  ): Promise<void> {
    if (!organizerId) return;
    try {
      const profile = await this.organizerService.findById(organizerId.toString());
      await this.notifyUser(profile.user, title, body);
    } catch (err) {
      this.logger.warn(`Organizer booking notification failed: ${String(err)}`);
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
    const advanceAmount = Math.round(b.amount * 0.3);
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
      balanceAmount: b.amount - advanceAmount,
      progress: b.progress,
      steps: b.steps,
      timeline: b.timeline,
      status: b.status,
      organizer,
      quotationId: b.quotation ? b.quotation.toString() : null,
      createdAt: b.createdAt,
      updatedAt: b.updatedAt,
    };
  }

  // ---------------------------------------------------------------------------
  // Home card (reused by the home module) — ongoing booking only
  // ---------------------------------------------------------------------------

  async getActiveForUser(userId: string): Promise<ActiveBookingView | null> {
    const booking = await this.bookingModel
      .findOne({ customer: new Types.ObjectId(userId), status: { $in: ONGOING_BOOKING_STATUSES } })
      .sort({ createdAt: -1 })
      .exec();
    if (!booking) return null;
    return {
      id: booking._id.toString(),
      ref: booking.ref,
      title: booking.title,
      description: booking.description,
      progress: booking.progress,
      daysToGo: this.daysUntil(booking.eventDate),
      steps: booking.steps,
    };
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
      progress: STATUS_META[BookingStatus.PENDING].progress,
      status: BookingStatus.PENDING,
      steps: [
        { label: 'Booking placed', done: true },
        { label: 'Organizer confirmed', done: false },
        { label: 'Event in progress', done: false },
        { label: 'Completed', done: false },
      ],
      timeline: [
        {
          status: BookingStatus.PENDING,
          label: STATUS_META[BookingStatus.PENDING].label,
          at: new Date(),
        },
      ],
    });

    await this.notifyUser(
      created.customer,
      'Booking placed 🎉',
      `Your booking ${created.ref} is placed. We've asked the organizer to confirm.`,
      '/workspace',
    );
    await this.notifyOrganizer(
      created.organizer,
      'New booking to confirm',
      `A customer booked you for their ${seed.occasion || 'event'} (${created.ref}). Please confirm.`,
    );

    const populated = await created.populate('organizer', 'name initials avatarColor tier rating');
    return this.detailView(populated);
  }

  private deriveEventDate(when: string): Date {
    const parsed = when ? new Date(`${when} ${new Date().getFullYear()}`) : new Date(NaN);
    if (!Number.isNaN(parsed.getTime()) && parsed.getTime() > Date.now()) return parsed;
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
    return bookings.map((b) => this.detailView(b));
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

    if (TERMINAL.includes(booking.status)) {
      throw new ForbiddenException(`This booking is already ${booking.status}`);
    }

    const owner = this.isOwner(booking, actor);
    const manager = this.isAdmin(actor) || (await this.isOwningOrganizer(booking, actor));

    if (dto.status === BookingStatus.CANCELLED) {
      // Either party may cancel while the booking is still cancellable.
      if (!owner && !manager) throw new ForbiddenException('You cannot cancel this booking');
      if (![BookingStatus.PENDING, BookingStatus.CONFIRMED].includes(booking.status)) {
        throw new ForbiddenException('This booking can no longer be cancelled');
      }
    } else {
      // Confirm / progress / complete / reject are organizer/admin actions.
      if (!manager) throw new ForbiddenException('Only the organizer can update this booking');
    }

    const meta = STATUS_META[dto.status];
    booking.status = dto.status;
    if (meta.progress > 0 || dto.status === BookingStatus.COMPLETED) {
      booking.progress = meta.progress;
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

  /** Marks the checklist steps done up to the current status. */
  private syncSteps(booking: BookingDocument): void {
    const order = [
      BookingStatus.PENDING,
      BookingStatus.CONFIRMED,
      BookingStatus.IN_PROGRESS,
      BookingStatus.COMPLETED,
    ];
    const reached = order.indexOf(booking.status);
    if (reached < 0) return; // cancelled / rejected — leave steps as-is
    booking.steps = booking.steps.map((s, i) => ({ ...s, done: i <= reached }));
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
          'Booking confirmed',
          `Your organizer confirmed booking ${ref}.`,
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
          'Booking could not be taken',
          `Booking ${ref} was declined by the organizer.`,
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
      ![BookingStatus.PENDING, BookingStatus.CANCELLED, BookingStatus.REJECTED].includes(
        booking.status,
      )
    ) {
      throw new ForbiddenException('Only a pending or closed booking can be deleted');
    }
    await booking.deleteOne();
  }
}
