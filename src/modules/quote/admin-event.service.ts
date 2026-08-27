import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  QuoteRequest,
  QuoteRequestDocument,
  QuoteRequestStatus,
} from './schemas/quote-request.schema';
import { Quotation, QuotationDocument, QuotationStatus } from './schemas/quotation.schema';
import { ListQuoteRequestsDto } from './dto/list-quote-requests.dto';
import { PaginatedResult } from '../../common/dto/pagination.dto';
import { User, UserDocument } from '../user/schemas/user.schema';
import { Booking, BookingDocument } from '../booking/schemas/booking.schema';

export const REQUEST_STATUS_LABEL: Record<QuoteRequestStatus, string> = {
  [QuoteRequestStatus.OPEN]: 'Awaiting quotes',
  [QuoteRequestStatus.QUOTED]: 'Quotes received',
  [QuoteRequestStatus.ACCEPTED]: 'Quote accepted',
  [QuoteRequestStatus.CANCELLED]: 'Cancelled',
  [QuoteRequestStatus.CLOSED]: 'Closed',
};

/**
 * The event pipeline — what customers are planning before anything is booked.
 *
 * The unit is the quote request: one customer, one occasion, and every
 * organizer that priced it. Bookings are the other side of this line and have
 * their own admin section; a request that produced one links across to it.
 */
@Injectable()
export class AdminEventService {
  constructor(
    @InjectModel(QuoteRequest.name) private readonly requestModel: Model<QuoteRequestDocument>,
    @InjectModel(Quotation.name) private readonly quotationModel: Model<QuotationDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Booking.name) private readonly bookingModel: Model<BookingDocument>,
  ) {}

  async list(query: ListQuoteRequestsDto): Promise<PaginatedResult<Record<string, unknown>>> {
    const filter: Record<string, unknown> = {};
    if (query.status) filter.status = query.status;

    const search = query.search?.trim();
    if (search) {
      const safe = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const rx = new RegExp(safe, 'i');
      // A customer-name search resolves to ids first: the name lives on the
      // user document, not on the request.
      const users = await this.userModel.find({ name: rx }).select('_id').exec();
      filter.$or = [
        { occasion: rx },
        { where: rx },
        ...(users.length ? [{ customer: { $in: users.map((u) => u._id) } }] : []),
      ];
    }

    const [rows, total] = await Promise.all([
      this.requestModel
        .find(filter)
        .populate('customer', 'name email phone')
        .populate('organizer', 'name')
        .sort({ createdAt: -1 })
        .skip(query.skip)
        .limit(query.limit)
        .exec(),
      this.requestModel.countDocuments(filter).exec(),
    ]);

    // Live quotation counts for the listed requests, in one query.
    const ids = rows.map((r) => r._id);
    const quoted = await this.quotationModel
      .aggregate<{ _id: Types.ObjectId; n: number }>([
        {
          $match: {
            request: { $in: ids },
            status: { $nin: [QuotationStatus.DRAFT, QuotationStatus.WITHDRAWN] },
          },
        },
        { $group: { _id: '$request', n: { $sum: 1 } } },
      ])
      .exec();
    const byRequest = new Map(quoted.map((q) => [q._id.toString(), q.n]));

    return {
      data: rows.map((r) => ({
        ...this.rowView(r),
        quoteCount: byRequest.get(r._id.toString()) ?? 0,
      })),
      meta: {
        total,
        page: query.page,
        limit: query.limit,
        pages: Math.max(1, Math.ceil(total / query.limit)),
      },
    };
  }

  async counts(): Promise<Record<string, number>> {
    const [grouped, all] = await Promise.all([
      this.requestModel
        .aggregate<{
          _id: QuoteRequestStatus;
          n: number;
        }>([{ $group: { _id: '$status', n: { $sum: 1 } } }])
        .exec(),
      this.requestModel.countDocuments().exec(),
    ]);
    const counts: Record<string, number> = { all };
    for (const s of Object.values(QuoteRequestStatus)) counts[s] = 0;
    for (const g of grouped) counts[g._id] = g.n;
    return counts;
  }

  /** One event: the brief, every organizer response, and the booking if any. */
  async detail(id: string): Promise<Record<string, unknown>> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Event not found');
    const request = await this.requestModel
      .findById(id)
      .populate('customer', 'name email phone city')
      .populate('organizer', 'name')
      .exec();
    if (!request) throw new NotFoundException('Event not found');

    const [quotations, booking] = await Promise.all([
      this.quotationModel
        .find({
          request: request._id,
          status: { $nin: [QuotationStatus.DRAFT, QuotationStatus.WITHDRAWN] },
        })
        .populate('organizer', 'name tier rating')
        .sort({ updatedAt: -1 })
        .exec(),
      this.bookingModel.findOne({ request: request._id }).exec(),
    ]);

    return {
      ...this.rowView(request),
      budget: request.budget,
      categories: request.categories ?? [],
      ideas: request.ideas,
      quotes: quotations.map((q) => {
        const org = q.organizer as unknown as { name?: string; tier?: string } | null;
        return {
          id: q._id.toString(),
          organizerName: org?.name ?? 'Organizer',
          organizerTier: org?.tier ?? '',
          status: q.status,
          grandTotal: q.grandTotal,
          advancePercentage: q.advancePercentage,
          sentAt: q.updatedAt ?? q.createdAt ?? null,
        };
      }),
      // The link across to the Bookings section, when this event became one.
      booking: booking
        ? {
            id: booking._id.toString(),
            ref: booking.ref,
            status: booking.status,
            amount: booking.amount,
          }
        : null,
    };
  }

  private rowView(r: QuoteRequestDocument): Record<string, unknown> {
    const cust = r.customer as unknown as Record<string, unknown> | undefined;
    const org = r.organizer as unknown as Record<string, unknown> | null;
    return {
      id: r._id.toString(),
      occasion: r.occasion,
      when: r.when,
      where: r.where,
      guests: r.guests,
      status: r.status,
      statusLabel: REQUEST_STATUS_LABEL[r.status] ?? r.status,
      customer:
        cust && 'name' in cust
          ? {
              id: (cust._id as Types.ObjectId).toString(),
              name: (cust.name as string) ?? '',
              email: (cust.email as string) ?? '',
              phone: (cust.phone as string) ?? '',
            }
          : null,
      /** Set only when the customer asked one specific organizer. */
      targetedOrganizer: org && 'name' in org ? ((org.name as string) ?? null) : null,
      createdAt: r.createdAt ?? null,
      updatedAt: r.updatedAt ?? null,
    };
  }
}
