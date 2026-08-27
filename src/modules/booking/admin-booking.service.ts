import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Booking, BookingDocument, BookingStatus, PaymentStatus } from './schemas/booking.schema';
import { ListBookingsDto } from './dto/list-bookings.dto';
import { PaginatedResult } from '../../common/dto/pagination.dto';

export const BOOKING_STATUS_LABEL: Record<BookingStatus, string> = {
  [BookingStatus.PENDING]: 'Booking placed',
  [BookingStatus.AWAITING_ORGANIZER]: 'Awaiting organizer',
  [BookingStatus.CONFIRMED]: 'Confirmed',
  [BookingStatus.IN_PROGRESS]: 'In progress',
  [BookingStatus.COMPLETED]: 'Completed',
  [BookingStatus.CANCELLED]: 'Cancelled',
  [BookingStatus.REJECTED]: 'Declined',
  [BookingStatus.EXPIRED]: 'Expired',
};

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  [PaymentStatus.UNPAID]: 'Unpaid',
  [PaymentStatus.ADVANCE_PAID]: 'Advance paid',
  [PaymentStatus.PAID_IN_FULL]: 'Paid in full',
};

/** Totals across whatever slice of bookings the admin is looking at. */
export interface PaymentTotals {
  bookings: number;
  contractedValue: number;
  collected: number;
  outstanding: number;
}

/**
 * Admin view of bookings, and the finance derived from them.
 *
 * IMPORTANT — there is no payments ledger in Evently. No transaction
 * collection, no gateway; a booking's `amountPaid` is set when the booking is
 * created. Every figure the payments view reports is therefore derived from
 * booking records, and the console labels it as booking finance rather than
 * implying money moved through a payment processor. Nothing here invents an
 * amount that is not stored on a booking.
 */
@Injectable()
export class AdminBookingService {
  constructor(@InjectModel(Booking.name) private readonly bookingModel: Model<BookingDocument>) {}

  private buildFilter(query: ListBookingsDto): Record<string, unknown> {
    const filter: Record<string, unknown> = {};
    if (query.status) filter.status = query.status;
    if (query.paymentStatus) filter.paymentStatus = query.paymentStatus;

    const search = query.search?.trim();
    if (search) {
      const safe = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const rx = new RegExp(safe, 'i');
      filter.$or = [{ ref: rx }, { title: rx }, { location: rx }];
    }
    return filter;
  }

  async list(query: ListBookingsDto): Promise<PaginatedResult<Record<string, unknown>>> {
    const filter = this.buildFilter(query);

    const [rows, total] = await Promise.all([
      this.bookingModel
        .find(filter)
        .populate('customer', 'name email phone')
        .populate('organizer', 'name')
        .sort({ createdAt: -1 })
        .skip(query.skip)
        .limit(query.limit)
        .exec(),
      this.bookingModel.countDocuments(filter).exec(),
    ]);

    return {
      data: rows.map((b) => this.rowView(b)),
      meta: {
        total,
        page: query.page,
        limit: query.limit,
        pages: Math.max(1, Math.ceil(total / query.limit)),
      },
    };
  }

  async counts(): Promise<Record<string, number>> {
    const [byStatus, byPayment, all] = await Promise.all([
      this.bookingModel
        .aggregate<{
          _id: BookingStatus;
          n: number;
        }>([{ $group: { _id: '$status', n: { $sum: 1 } } }])
        .exec(),
      this.bookingModel
        .aggregate<{
          _id: PaymentStatus;
          n: number;
        }>([{ $group: { _id: '$paymentStatus', n: { $sum: 1 } } }])
        .exec(),
      this.bookingModel.countDocuments().exec(),
    ]);

    const counts: Record<string, number> = { all };
    for (const s of Object.values(BookingStatus)) counts[s] = 0;
    for (const p of Object.values(PaymentStatus)) counts[p] = 0;
    for (const g of byStatus) counts[g._id] = g.n;
    for (const g of byPayment) counts[g._id] = g.n;
    return counts;
  }

  async detail(id: string): Promise<Record<string, unknown>> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Booking not found');
    const booking = await this.bookingModel
      .findById(id)
      .populate('customer', 'name email phone city')
      .populate('organizer', 'name tier rating')
      .exec();
    if (!booking) throw new NotFoundException('Booking not found');

    return {
      ...this.rowView(booking),
      description: booking.description,
      progress: booking.progress,
      steps: booking.steps ?? [],
      timeline: booking.timeline ?? [],
      declineReason: booking.declineReason ?? '',
      organizerRespondBy: booking.organizerRespondBy ?? null,
      tasks: (booking.tasks ?? []).map((t) => ({
        title: t.title,
        status: t.status,
        assigneeName: t.assigneeName,
        assignmentStatus: t.assignmentStatus,
        amount: t.amount ?? 0,
      })),
    };
  }

  /**
   * Money, across the filtered slice AND overall.
   *
   * Summed with an aggregation rather than by paging every booking into memory,
   * so the totals are correct for the whole slice and not just the page shown.
   */
  async totals(query: ListBookingsDto): Promise<PaymentTotals> {
    const filter = this.buildFilter(query);
    const [agg] = await this.bookingModel
      .aggregate<{ bookings: number; contractedValue: number; collected: number }>([
        { $match: filter },
        {
          $group: {
            _id: null,
            bookings: { $sum: 1 },
            contractedValue: { $sum: '$amount' },
            collected: { $sum: { $ifNull: ['$amountPaid', 0] } },
          },
        },
      ])
      .exec();

    const contractedValue = agg?.contractedValue ?? 0;
    const collected = agg?.collected ?? 0;
    return {
      bookings: agg?.bookings ?? 0,
      contractedValue,
      collected,
      outstanding: Math.max(0, contractedValue - collected),
    };
  }

  private rowView(b: BookingDocument): Record<string, unknown> {
    const cust = b.customer as unknown as Record<string, unknown> | undefined;
    const org = b.organizer as unknown as Record<string, unknown> | undefined;

    // Legacy rows predate the stored snapshot; fall back the same way the
    // customer-facing detail view does so the two can never disagree.
    const advancePercentage = b.advancePercentage || 30;
    const advanceAmount = b.advanceAmount || Math.round((b.amount * advancePercentage) / 100);
    const amountPaid = b.amountPaid ?? 0;

    return {
      id: b._id.toString(),
      ref: b.ref,
      title: b.title,
      occasion: b.occasion,
      location: b.location,
      eventDate: b.eventDate,
      status: b.status,
      statusLabel: BOOKING_STATUS_LABEL[b.status] ?? b.status,
      paymentStatus: b.paymentStatus ?? PaymentStatus.UNPAID,
      paymentStatusLabel:
        PAYMENT_STATUS_LABEL[b.paymentStatus ?? PaymentStatus.UNPAID] ?? b.paymentStatus,
      amount: b.amount,
      advancePercentage,
      advanceAmount,
      amountPaid,
      outstanding: Math.max(0, b.amount - amountPaid),
      advancePaidAt: b.advancePaidAt ?? null,
      customer:
        cust && 'name' in cust
          ? {
              id: (cust._id as Types.ObjectId).toString(),
              name: (cust.name as string) ?? '',
              email: (cust.email as string) ?? '',
              phone: (cust.phone as string) ?? '',
            }
          : null,
      organizer:
        org && 'name' in org
          ? { id: (org._id as Types.ObjectId).toString(), name: (org.name as string) ?? '' }
          : null,
      createdAt: b.createdAt ?? null,
      updatedAt: b.updatedAt ?? null,
    };
  }
}
