import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { randomBytes, randomUUID } from 'node:crypto';
import { FilterQuery, Model, Types } from 'mongoose';
import { OrganizerService } from '../organizer/organizer.service';
import { PublicEvent, PublicEventDocument } from './schemas/public-event.schema';
import { EventTicketType, EventTicketTypeDocument } from './schemas/event-ticket-type.schema';
import { EventBooking, EventBookingDocument } from './schemas/event-booking.schema';
import { EventTicket, EventTicketDocument } from './schemas/event-ticket.schema';
import {
  CheckInResult,
  EventBookingStatus,
  EventPaymentStatus,
  EventTicketStatus,
  HOLDING_BOOKING_STATUSES,
  LiveAccess,
  MemoryUploaders,
  PublicEventStatus,
  TicketTypeStatus,
  canTransition,
  liveStateOf,
} from './public-event.constants';
import { isAdmittable, isCheckInOpen, isOnSale, isSoldOut } from './access';
import {
  ChangeEventStatusDto,
  CheckInDto,
  CreatePublicEventDto,
  EventLiveStreamSettingsDto,
  EventMemoriesSettingsDto,
  ListAttendeesDto,
  ListPublicEventsDto,
  TicketTypeDto,
  UpdatePublicEventDto,
  UpdateTicketTypeDto,
} from './dto/public-event.dto';

/**
 * Public events, from the organizer's side.
 *
 * Two rules run through everything here, and they are the reason the code is
 * shaped the way it is:
 *
 *   Ownership is resolved, never accepted. Every method takes the authenticated
 *   user id and turns it into an organizer profile itself. No method takes an
 *   organizer id from a caller, so there is no request that can name somebody
 *   else's organizer and be served their events.
 *
 *   Inventory is the server's. Seats move by one conditional update whose
 *   filter contains the remaining count, so two buyers racing for the last
 *   ticket cannot both be told yes.
 */
/**
 * One ticket type as the organizer's screens read it: the stored fields, plus
 * the two answers they always want next to them.
 *
 * Written out rather than inferred from `toJSON()`. That inference drags in
 * Mongoose's own bundled driver types, which the compiler then cannot name
 * from here — so the shape the API actually returns is stated instead.
 */
export interface TicketTypeView {
  id: string;
  name: string;
  description: string;
  price: number;
  totalQuantity: number;
  availableQuantity: number;
  salesStart: Date | null;
  salesEnd: Date | null;
  maxPerCustomer: number;
  status: TicketTypeStatus;
  archived: boolean;
  /** How many have gone, which is the total less what is left. */
  sold: number;
  /** Whether it can be bought at this instant — stock, window, pause and all. */
  onSale: boolean;
}

@Injectable()
export class PublicEventService {
  constructor(
    @InjectModel(PublicEvent.name)
    private readonly eventModel: Model<PublicEventDocument>,
    @InjectModel(EventTicketType.name)
    private readonly typeModel: Model<EventTicketTypeDocument>,
    @InjectModel(EventBooking.name)
    private readonly bookingModel: Model<EventBookingDocument>,
    @InjectModel(EventTicket.name)
    private readonly ticketModel: Model<EventTicketDocument>,
    private readonly organizerService: OrganizerService,
  ) {}

  // -------------------------------------------------------------------------
  // Identity
  // -------------------------------------------------------------------------

  /**
   * The organizer profile behind an authenticated user.
   *
   * Every organizer-side entry point starts here. A user without a profile is
   * refused rather than given an empty list, because an empty list reads as
   * "you have no events" when the truth is "you are not an organizer".
   */
  private async organizerId(userId: string): Promise<Types.ObjectId> {
    const profile = await this.organizerService.findByUser(userId);
    if (!profile) throw new ForbiddenException('No organizer profile is linked to your account');
    return profile._id;
  }

  /**
   * One of this organizer's events, by id.
   *
   * The owner is in the filter rather than checked after loading: a query that
   * cannot match somebody else's event cannot leak one through a timing
   * difference or a forgotten early return, and the 404 is the same whether
   * the event belongs to another organizer or does not exist — which is the
   * answer that tells an attacker the least.
   */
  /** The organizer's own event, or a 404 — for sibling services in this module. */
  ownedEvent(userId: string, eventId: string): Promise<PublicEventDocument> {
    return this.ownEvent(userId, eventId);
  }

  private async ownEvent(userId: string, eventId: string): Promise<PublicEventDocument> {
    if (!Types.ObjectId.isValid(eventId)) throw new NotFoundException('Event not found');
    const organizer = await this.organizerId(userId);
    const event = await this.eventModel.findOne({ _id: eventId, organizer }).exec();
    if (!event) throw new NotFoundException('Event not found');
    return event;
  }

  // -------------------------------------------------------------------------
  // The event itself
  // -------------------------------------------------------------------------

  async create(userId: string, dto: CreatePublicEventDto): Promise<PublicEventDocument> {
    const organizer = await this.organizerId(userId);
    const start = new Date(dto.startDateTime);
    const end = dto.endDateTime ? new Date(dto.endDateTime) : null;
    this.assertTimes(start, end);

    return this.eventModel.create({
      organizer,
      title: dto.title,
      category: dto.category ?? '',
      description: dto.description ?? '',
      coverUrl: dto.coverUrl ?? '',
      contactName: dto.contactName ?? '',
      contactPhone: dto.contactPhone ?? '',
      contactEmail: dto.contactEmail ?? '',
      startDateTime: start,
      endDateTime: end,
      timezone: dto.timezone || 'Asia/Kolkata',
      venue: dto.venue ?? {},
      capacity: dto.capacity ?? 0,
      maxPerCustomer: dto.maxPerCustomer ?? 0,
      status: PublicEventStatus.DRAFT,
    });
  }

  async update(
    userId: string,
    eventId: string,
    dto: UpdatePublicEventDto,
  ): Promise<PublicEventDocument> {
    const event = await this.ownEvent(userId, eventId);
    this.assertEditable(event);

    if (dto.title !== undefined) event.title = dto.title;
    if (dto.category !== undefined) event.category = dto.category;
    if (dto.description !== undefined) event.description = dto.description;
    if (dto.coverUrl !== undefined) event.coverUrl = dto.coverUrl;
    if (dto.contactName !== undefined) event.contactName = dto.contactName;
    if (dto.contactPhone !== undefined) event.contactPhone = dto.contactPhone;
    if (dto.contactEmail !== undefined) event.contactEmail = dto.contactEmail;
    if (dto.timezone !== undefined) event.timezone = dto.timezone;
    if (dto.capacity !== undefined) event.capacity = dto.capacity;
    if (dto.maxPerCustomer !== undefined) event.maxPerCustomer = dto.maxPerCustomer;
    if (dto.venue !== undefined) {
      event.venue = {
        name: dto.venue.name ?? event.venue?.name ?? '',
        address: dto.venue.address ?? event.venue?.address ?? '',
        city: dto.venue.city ?? event.venue?.city ?? '',
        state: dto.venue.state ?? event.venue?.state ?? '',
        latitude: dto.venue.latitude ?? event.venue?.latitude ?? null,
        longitude: dto.venue.longitude ?? event.venue?.longitude ?? null,
      };
    }

    const start = dto.startDateTime ? new Date(dto.startDateTime) : event.startDateTime;
    const end =
      dto.endDateTime !== undefined
        ? dto.endDateTime
          ? new Date(dto.endDateTime)
          : null
        : event.endDateTime;
    this.assertTimes(start, end);
    event.startDateTime = start;
    event.endDateTime = end;

    await event.save();
    return event;
  }

  /** An end before its own start is a typo, and it breaks every window we derive. */
  private assertTimes(start: Date, end: Date | null): void {
    if (Number.isNaN(start.getTime())) throw new BadRequestException('Event start is not a date');
    if (end) {
      if (Number.isNaN(end.getTime())) throw new BadRequestException('Event end is not a date');
      if (end.getTime() <= start.getTime()) {
        throw new BadRequestException('The event cannot end before it starts');
      }
    }
  }

  /**
   * A completed or cancelled event is a record of something that happened.
   * Editing it would rewrite what the people who were there were told.
   */
  private assertEditable(event: PublicEventDocument): void {
    if (
      event.status === PublicEventStatus.COMPLETED ||
      event.status === PublicEventStatus.CANCELLED
    ) {
      throw new BadRequestException(`A ${event.status} event can no longer be edited`);
    }
  }

  async list(userId: string, query: ListPublicEventsDto) {
    const organizer = await this.organizerId(userId);
    const filter: FilterQuery<PublicEventDocument> = { organizer };
    if (query.status) filter.status = query.status;
    if (query.q) {
      /* Escaped before it reaches the regex: a title the organizer searched
         for with a "(" in it is a search, not a broken query. */
      const safe = query.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.title = { $regex: safe, $options: 'i' };
    }

    const limit = query.limit ?? 20;
    const page = query.page ?? 0;

    const [items, total] = await Promise.all([
      this.eventModel
        .find(filter)
        .sort({ startDateTime: -1 })
        .skip(page * limit)
        .limit(limit)
        .exec(),
      this.eventModel.countDocuments(filter).exec(),
    ]);

    /* Each card carries its own numbers. The list is the organizer's whole
       picture of their events, and a row that cannot say how many tickets it
       has sold sends them into the event to find out. */
    const summaries = await Promise.all(items.map((e) => this.summaryFor(e)));
    return { items: summaries, total, page, limit };
  }

  async findOne(userId: string, eventId: string) {
    const event = await this.ownEvent(userId, eventId);
    const types = await this.typeModel.find({ event: event._id, archived: false }).exec();
    return {
      event: event.toJSON(),
      ticketTypes: types.map((t) => t.toJSON()),
      liveState: liveStateOf(event.liveStream?.startsAt, event.liveStream?.endsAt),
    };
  }

  /**
   * Move an event's status, if the table allows it.
   *
   * Publishing is the one move with a precondition beyond the table: an event
   * with nothing to sell is not a catalogue entry, it is an empty page, and a
   * customer who opens it has been sent somewhere pointless.
   */
  async changeStatus(userId: string, eventId: string, dto: ChangeEventStatusDto) {
    const event = await this.ownEvent(userId, eventId);
    const to = dto.status;

    if (event.status === to) return event.toJSON();

    if (!canTransition(event.status, to)) {
      throw new BadRequestException(`A ${event.status} event cannot become ${to}`);
    }

    if (to === PublicEventStatus.PUBLISHED) {
      const sellable = await this.typeModel.countDocuments({
        event: event._id,
        archived: false,
      });
      if (sellable === 0) {
        throw new BadRequestException('Add at least one ticket type before publishing');
      }
      if (!event.publishedAt) event.publishedAt = new Date();
    }

    if (to === PublicEventStatus.CANCELLED) {
      event.cancelledAt = new Date();
      event.cancelReason = dto.reason ?? '';
    }

    event.status = to;
    await event.save();

    /* Publishing can land straight on sold out — a re-published event whose
       stock never came back, for instance. The inventory decides, here. */
    if (to === PublicEventStatus.PUBLISHED) await this.refreshSoldOut(event);

    return event.toJSON();
  }

  /**
   * The same recomputation, reachable by id.
   *
   * The customer's booking path moves stock too, and after a sale the sign on
   * the catalogue has to agree with the shelf. Public so that path can ask for
   * it without being handed the organizer's document.
   */
  async refreshSoldOutById(eventId: Types.ObjectId): Promise<void> {
    const event = await this.eventModel.findById(eventId).exec();
    if (event) await this.refreshSoldOut(event);
  }

  /**
   * Set or clear SOLD_OUT from what is actually left.
   *
   * Derived rather than declared, and recomputed after anything that can move
   * stock. An organizer who adds twenty more VIP seats should not also have to
   * remember to take the "sold out" sign down.
   */
  private async refreshSoldOut(event: PublicEventDocument): Promise<void> {
    if (
      event.status !== PublicEventStatus.PUBLISHED &&
      event.status !== PublicEventStatus.SOLD_OUT
    ) {
      return;
    }
    const types = await this.typeModel.find({ event: event._id, archived: false }).exec();
    const out = isSoldOut(event, types);
    const next = out ? PublicEventStatus.SOLD_OUT : PublicEventStatus.PUBLISHED;
    if (event.status !== next) {
      event.status = next;
      await event.save();
    }
  }

  // -------------------------------------------------------------------------
  // Ticket types
  // -------------------------------------------------------------------------

  async listTicketTypes(userId: string, eventId: string): Promise<TicketTypeView[]> {
    const event = await this.ownEvent(userId, eventId);
    const types = await this.typeModel
      .find({ event: event._id, archived: false })
      .sort({ price: 1, createdAt: 1 })
      .exec();
    const now = new Date();
    return types.map((t) => ({
      id: t._id.toString(),
      name: t.name,
      description: t.description,
      price: t.price,
      totalQuantity: t.totalQuantity,
      availableQuantity: t.availableQuantity,
      salesStart: t.salesStart,
      salesEnd: t.salesEnd,
      maxPerCustomer: t.maxPerCustomer,
      status: t.status,
      archived: t.archived,
      sold: Math.max(0, t.totalQuantity - t.availableQuantity),
      onSale: isOnSale(event, t, now),
    }));
  }

  async createTicketType(userId: string, eventId: string, dto: TicketTypeDto) {
    const event = await this.ownEvent(userId, eventId);
    this.assertEditable(event);
    this.assertSalesWindow(dto.salesStart, dto.salesEnd);

    const created = await this.typeModel.create({
      event: event._id,
      organizer: event.organizer,
      name: dto.name,
      description: dto.description ?? '',
      price: dto.price,
      totalQuantity: dto.totalQuantity,
      /* Seeded from the total and independent from here on: the two numbers
         answer different questions once a single ticket has been sold. */
      availableQuantity: dto.totalQuantity,
      salesStart: dto.salesStart ? new Date(dto.salesStart) : null,
      salesEnd: dto.salesEnd ? new Date(dto.salesEnd) : null,
      maxPerCustomer: dto.maxPerCustomer ?? 0,
      status: (dto.status as TicketTypeStatus) ?? TicketTypeStatus.ACTIVE,
    });

    await this.refreshSoldOut(event);
    return created.toJSON();
  }

  async updateTicketType(
    userId: string,
    eventId: string,
    typeId: string,
    dto: UpdateTicketTypeDto,
  ) {
    const event = await this.ownEvent(userId, eventId);
    this.assertEditable(event);
    if (!Types.ObjectId.isValid(typeId)) throw new NotFoundException('Ticket type not found');

    const type = await this.typeModel
      .findOne({ _id: typeId, event: event._id, archived: false })
      .exec();
    if (!type) throw new NotFoundException('Ticket type not found');

    if (dto.name !== undefined) type.name = dto.name;
    if (dto.description !== undefined) type.description = dto.description;
    if (dto.price !== undefined) type.price = dto.price;
    if (dto.maxPerCustomer !== undefined) type.maxPerCustomer = dto.maxPerCustomer;
    if (dto.status !== undefined) type.status = dto.status as TicketTypeStatus;
    if (dto.salesStart !== undefined) {
      type.salesStart = dto.salesStart ? new Date(dto.salesStart) : null;
    }
    if (dto.salesEnd !== undefined) {
      type.salesEnd = dto.salesEnd ? new Date(dto.salesEnd) : null;
    }
    this.assertSalesWindow(
      type.salesStart ? type.salesStart.toISOString() : undefined,
      type.salesEnd ? type.salesEnd.toISOString() : undefined,
    );

    if (dto.totalQuantity !== undefined) {
      /*
       * Stock moves by the difference, never by assignment.
       *
       * `available` is not a view of `total` — it is what is left after every
       * sale. Setting it from the new total would hand back every seat already
       * sold and let the event oversell by exactly its own sales history.
       */
      const sold = type.totalQuantity - type.availableQuantity;
      if (dto.totalQuantity < sold) {
        throw new BadRequestException(
          `${sold} of these have already been sold, so the total cannot go below ${sold}`,
        );
      }
      type.availableQuantity = dto.totalQuantity - sold;
      type.totalQuantity = dto.totalQuantity;
    }

    await type.save();
    await this.refreshSoldOut(event);
    return type.toJSON();
  }

  private assertSalesWindow(start?: string, end?: string): void {
    if (start && end && new Date(end).getTime() <= new Date(start).getTime()) {
      throw new BadRequestException('Ticket sales cannot end before they start');
    }
  }

  /**
   * Retire a ticket type.
   *
   * Archived, not deleted, and refused outright once anybody holds one: a
   * ticket whose type has vanished is a ticket nobody at the door can explain.
   */
  async archiveTicketType(userId: string, eventId: string, typeId: string) {
    const event = await this.ownEvent(userId, eventId);
    if (!Types.ObjectId.isValid(typeId)) throw new NotFoundException('Ticket type not found');

    const type = await this.typeModel.findOne({ _id: typeId, event: event._id }).exec();
    if (!type) throw new NotFoundException('Ticket type not found');

    const sold = await this.bookingModel.countDocuments({
      ticketType: type._id,
      status: { $in: HOLDING_BOOKING_STATUSES },
    });
    if (sold > 0) {
      throw new BadRequestException(
        'Tickets of this type have already been sold — pause it instead of removing it',
      );
    }

    type.archived = true;
    await type.save();
    await this.refreshSoldOut(event);
    return { id: type._id.toString(), archived: true };
  }

  // -------------------------------------------------------------------------
  // The dashboard
  // -------------------------------------------------------------------------

  /** The numbers behind one event's card in the list. */
  private async summaryFor(event: PublicEventDocument) {
    const [types, sold] = await Promise.all([
      this.typeModel.find({ event: event._id, archived: false }).exec(),
      this.ticketModel.countDocuments({
        event: event._id,
        status: { $in: [EventTicketStatus.VALID, EventTicketStatus.CHECKED_IN] },
      }),
    ]);
    const capacity = types.reduce((n, t) => n + t.totalQuantity, 0);
    const remaining = types.reduce((n, t) => n + t.availableQuantity, 0);
    const startingPrice = types.length ? Math.min(...types.map((t) => t.price)) : 0;

    return {
      ...event.toJSON(),
      ticketTypeCount: types.length,
      capacity,
      sold,
      remaining,
      startingPrice,
    };
  }

  /**
   * The event dashboard.
   *
   * Every figure is counted here, from the collections themselves. None of it
   * is a running total kept on the event document, because a counter that is
   * incremented in one place and read in five is a counter that eventually
   * disagrees with the tickets it claims to describe.
   */
  async dashboard(userId: string, eventId: string) {
    const event = await this.ownEvent(userId, eventId);

    const [types, ticketCounts, revenueRows, bookingCount] = await Promise.all([
      this.typeModel.find({ event: event._id, archived: false }).exec(),
      this.ticketModel.aggregate<{ _id: EventTicketStatus; n: number }>([
        { $match: { event: event._id } },
        { $group: { _id: '$status', n: { $sum: 1 } } },
      ]),
      /* Only money that actually arrived. A pending booking is a seat held,
         not revenue, and counting it is how a dashboard tells an organizer
         they earned more than their bank did. */
      this.bookingModel.aggregate<{ _id: null; total: number }>([
        {
          $match: {
            event: event._id,
            status: EventBookingStatus.CONFIRMED,
            paymentStatus: EventPaymentStatus.PAID,
          },
        },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      this.bookingModel.countDocuments({
        event: event._id,
        status: { $in: HOLDING_BOOKING_STATUSES },
      }),
    ]);

    const byStatus = new Map(ticketCounts.map((r) => [r._id, r.n]));
    const valid = byStatus.get(EventTicketStatus.VALID) ?? 0;
    const checkedIn = byStatus.get(EventTicketStatus.CHECKED_IN) ?? 0;

    const capacity = types.reduce((n, t) => n + t.totalQuantity, 0);
    const remaining = types.reduce((n, t) => n + t.availableQuantity, 0);

    return {
      eventId: event._id.toString(),
      status: event.status,
      ticketsSold: valid + checkedIn,
      ticketsRemaining: remaining,
      capacity,
      bookings: bookingCount,
      revenue: revenueRows[0]?.total ?? 0,
      checkedIn,
      pendingEntry: valid,
      liveState: liveStateOf(event.liveStream?.startsAt, event.liveStream?.endsAt),
      memoriesEnabled: event.memories?.enabled === true,
      liveStreamEnabled: event.liveStream?.enabled === true,
      byTicketType: types.map((t) => ({
        id: t._id.toString(),
        name: t.name,
        price: t.price,
        total: t.totalQuantity,
        remaining: t.availableQuantity,
        sold: Math.max(0, t.totalQuantity - t.availableQuantity),
      })),
    };
  }

  // -------------------------------------------------------------------------
  // Attendees
  // -------------------------------------------------------------------------

  /**
   * Who is coming, one row per seat.
   *
   * Per ticket rather than per booking: four seats bought together are four
   * people at the door, checked in one at a time.
   *
   * What this deliberately does not return: the QR token (`select: false` on
   * the schema, and never projected back in) and anything about how the
   * customer paid beyond whether they did. An organizer needs to know a
   * booking is settled; they have no business with the instrument.
   */
  async attendees(userId: string, eventId: string, query: ListAttendeesDto) {
    const event = await this.ownEvent(userId, eventId);
    const limit = query.limit ?? 50;
    const page = query.page ?? 0;

    const filter: FilterQuery<EventTicketDocument> = { event: event._id };
    if (query.checkIn === 'checked_in') filter.status = EventTicketStatus.CHECKED_IN;
    if (query.checkIn === 'pending') filter.status = EventTicketStatus.VALID;

    const [tickets, total] = await Promise.all([
      this.ticketModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(page * limit)
        .limit(limit)
        .populate('customer', 'name fullName email phone')
        .populate('ticketType', 'name price')
        .populate('booking', 'reference paymentStatus status amount createdAt')
        .exec(),
      this.ticketModel.countDocuments(filter).exec(),
    ]);

    const rows = tickets.map((t) => {
      const customer = t.customer as unknown as Record<string, unknown> | null;
      const type = t.ticketType as unknown as Record<string, unknown> | null;
      const booking = t.booking as unknown as Record<string, unknown> | null;
      return {
        ticketId: t._id.toString(),
        /* The short code, not the token. It is what the attendee reads out
           when a camera will not focus, and it admits nobody on its own. */
        code: t.code,
        status: t.status,
        checkedInAt: t.checkedInAt,
        customerName: (customer?.fullName as string) ?? (customer?.name as string) ?? '',
        customerEmail: (customer?.email as string) ?? '',
        customerPhone: (customer?.phone as string) ?? '',
        ticketTypeName: (type?.name as string) ?? '',
        bookingId: booking?._id ? String(booking._id) : '',
        bookingReference: (booking?.reference as string) ?? '',
        bookingStatus: (booking?.status as string) ?? '',
        paymentStatus: (booking?.paymentStatus as string) ?? '',
        amount: (booking?.amount as number) ?? 0,
        bookedAt: (booking?.createdAt as Date) ?? null,
      };
    });

    /* Filtered after shaping rather than in Mongo: the name lives on another
       collection, and a $lookup for a box an organizer types three letters
       into is more machinery than the page is worth. */
    const q = query.q?.trim().toLowerCase();
    const filtered = q
      ? rows.filter((r) =>
          [r.customerName, r.customerEmail, r.customerPhone, r.code, r.bookingReference]
            .join(' ')
            .toLowerCase()
            .includes(q),
        )
      : rows;

    return { items: filtered, total, page, limit };
  }

  // -------------------------------------------------------------------------
  // The door
  // -------------------------------------------------------------------------

  /**
   * Admit one ticket.
   *
   * Three answers, and the caller gets exactly one of them: allowed, already
   * in, or not a ticket for this door. Everything is decided here — the
   * scanner is a camera, not an authority, and a client that decides for
   * itself is a client that can be told to decide yes.
   *
   * The admit itself is one conditional update filtered on the status it
   * expects to find. Two staff scanning the same QR in the same second cannot
   * both be told "allowed": the second update matches nothing, and that is
   * what makes it "already checked in" rather than a double entry.
   */
  async checkIn(userId: string, eventId: string, dto: CheckInDto) {
    const event = await this.ownEvent(userId, eventId);

    if (!isCheckInOpen(event)) {
      return { result: CheckInResult.INVALID, reason: `This event is ${event.status}` };
    }

    const token = dto.qrToken?.trim();
    const code = dto.code?.trim().toUpperCase();
    if (!token && !code) throw new BadRequestException('Scan a ticket or enter its code');

    /* Scoped to this event in the filter. A valid ticket for the organizer's
       other event is not a ticket for this door, and finding it first and
       comparing afterwards is how that check gets forgotten. */
    const query: FilterQuery<EventTicketDocument> = { event: event._id };
    if (token) query.qrToken = token;
    else query.code = code;

    const ticket = await this.ticketModel
      .findOne(query)
      .populate('booking', 'status paymentStatus reference')
      .populate('customer', 'name fullName')
      .populate('ticketType', 'name')
      .exec();

    if (!ticket) return { result: CheckInResult.INVALID, reason: 'No such ticket for this event' };

    const booking = ticket.booking as unknown as { status?: EventBookingStatus } | null;
    const bookingStatus = (booking?.status as EventBookingStatus) ?? EventBookingStatus.PENDING;

    if (ticket.status === EventTicketStatus.CHECKED_IN) {
      return {
        result: CheckInResult.ALREADY,
        reason: 'This ticket has already been used',
        ticket: this.doorView(ticket),
      };
    }

    if (!isAdmittable(ticket.status, bookingStatus)) {
      return {
        result: CheckInResult.INVALID,
        reason:
          ticket.status === EventTicketStatus.CANCELLED ||
          ticket.status === EventTicketStatus.REFUNDED
            ? `This ticket was ${ticket.status}`
            : 'This booking is not confirmed',
        ticket: this.doorView(ticket),
      };
    }

    const admitted = await this.ticketModel
      .findOneAndUpdate(
        { _id: ticket._id, status: EventTicketStatus.VALID },
        {
          $set: {
            status: EventTicketStatus.CHECKED_IN,
            checkedInAt: new Date(),
            checkedInBy: new Types.ObjectId(userId),
          },
        },
        { new: true },
      )
      .populate('customer', 'name fullName')
      .populate('ticketType', 'name')
      .exec();

    if (!admitted) {
      /* Somebody else won the race between the read above and this update. */
      return {
        result: CheckInResult.ALREADY,
        reason: 'This ticket has already been used',
        ticket: this.doorView(ticket),
      };
    }

    return { result: CheckInResult.ALLOWED, ticket: this.doorView(admitted) };
  }

  /** What the door is shown: who, which ticket, when. Never the token. */
  private doorView(ticket: EventTicketDocument) {
    const customer = ticket.customer as unknown as Record<string, unknown> | null;
    const type = ticket.ticketType as unknown as Record<string, unknown> | null;
    return {
      ticketId: ticket._id.toString(),
      code: ticket.code,
      status: ticket.status,
      checkedInAt: ticket.checkedInAt,
      customerName: (customer?.fullName as string) ?? (customer?.name as string) ?? '',
      ticketTypeName: (type?.name as string) ?? '',
    };
  }

  // -------------------------------------------------------------------------
  // Memories and the stream
  // -------------------------------------------------------------------------

  async setMemories(userId: string, eventId: string, dto: EventMemoriesSettingsDto) {
    const event = await this.ownEvent(userId, eventId);
    const current = event.memories ?? ({} as PublicEventDocument['memories']);
    event.memories = {
      enabled: dto.enabled ?? current.enabled ?? false,
      uploaders:
        (dto.uploaders as MemoryUploaders) ?? current.uploaders ?? MemoryUploaders.CHECKED_IN,
      attendeeView: dto.attendeeView ?? current.attendeeView ?? true,
      attendeeDownload: dto.attendeeDownload ?? current.attendeeDownload ?? false,
      moderation: dto.moderation ?? current.moderation ?? false,
      uploadWindowDays: dto.uploadWindowDays ?? current.uploadWindowDays ?? 7,
    };
    await event.save();
    return event.memories;
  }

  async setLiveStream(userId: string, eventId: string, dto: EventLiveStreamSettingsDto) {
    const event = await this.ownEvent(userId, eventId);
    const current = event.liveStream ?? ({} as PublicEventDocument['liveStream']);

    const startsAt =
      dto.startsAt !== undefined
        ? dto.startsAt
          ? new Date(dto.startsAt)
          : null
        : current.startsAt;
    const endsAt =
      dto.endsAt !== undefined ? (dto.endsAt ? new Date(dto.endsAt) : null) : current.endsAt;
    if (startsAt && endsAt && endsAt.getTime() <= startsAt.getTime()) {
      throw new BadRequestException('The stream cannot end before it starts');
    }

    event.liveStream = {
      enabled: dto.enabled ?? current.enabled ?? false,
      access: (dto.access as LiveAccess) ?? current.access ?? LiveAccess.TICKETED,
      url: dto.url ?? current.url ?? '',
      startsAt,
      endsAt,
      replayEnabled: dto.replayEnabled ?? current.replayEnabled ?? false,
    };
    await event.save();
    return { ...event.liveStream, state: liveStateOf(startsAt, endsAt) };
  }

  // -------------------------------------------------------------------------
  // Minting (used by phase 2's booking flow; declared here so the rules that
  // guard inventory live with the inventory rather than beside the gateway)
  // -------------------------------------------------------------------------

  /**
   * Take `quantity` seats off a ticket type, or fail.
   *
   * One update, with the remaining count in the filter. Mongo applies it
   * atomically, so of two callers racing for the last seat exactly one matches
   * and the other gets null — which is the whole oversell guard, and the
   * reason none of this is a read-then-write.
   */
  async reserve(typeId: Types.ObjectId, quantity: number): Promise<EventTicketTypeDocument> {
    const taken = await this.typeModel
      .findOneAndUpdate(
        { _id: typeId, availableQuantity: { $gte: quantity } },
        { $inc: { availableQuantity: -quantity } },
        { new: true },
      )
      .exec();
    if (!taken) throw new BadRequestException('There are not enough tickets left');
    return taken;
  }

  /** Put seats back when a booking falls through. */
  async release(typeId: Types.ObjectId, quantity: number): Promise<void> {
    await this.typeModel
      .findByIdAndUpdate(typeId, { $inc: { availableQuantity: quantity } })
      .exec();
  }

  /**
   * One ticket's secret and its readable code.
   *
   * The token is 32 random bytes — not the ticket's id, not a hash of the
   * booking, nothing another ticket holder could compute from what they can
   * see. The code is short enough to read aloud and is checked against this
   * event only, so a collision across events admits nobody.
   */
  mintCredentials(): { qrToken: string; code: string } {
    return {
      qrToken: `${randomUUID()}.${randomBytes(32).toString('base64url')}`,
      code: randomBytes(5).toString('hex').toUpperCase(),
    };
  }
}
