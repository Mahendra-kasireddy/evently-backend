import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { randomBytes } from 'node:crypto';
import * as QRCode from 'qrcode';
import { FilterQuery, Model, Types } from 'mongoose';
import { PaymentService } from '../payment/payment.service';
import { PublicEvent, PublicEventDocument } from './schemas/public-event.schema';
import { EventTicketType, EventTicketTypeDocument } from './schemas/event-ticket-type.schema';
import { EventBooking, EventBookingDocument } from './schemas/event-booking.schema';
import { EventTicket, EventTicketDocument } from './schemas/event-ticket.schema';
import { PublicEventService } from './public-event.service';
import {
  EventBookingStatus,
  EventPaymentStatus,
  EventTicketStatus,
  HOLDING_BOOKING_STATUSES,
  LiveAccess,
  OCCUPYING_TICKET_STATUSES,
  PUBLIC_STATUSES,
  PublicEventStatus,
  liveStateOf,
} from './public-event.constants';
import {
  canAttendeeDownload,
  canAttendeeUpload,
  canAttendeeViewMemories,
  canWatchLive,
  isOnSale,
  isSelling,
  perCustomerLimit,
} from './access';
import {
  BrowsePublicEventsDto,
  ConfirmEventBookingDto,
  ListMyTicketsDto,
  StartEventBookingDto,
} from './dto/customer-public-event.dto';

/** Earth's radius in kilometres, for the distance filter. */
const EARTH_KM = 6371;

/**
 * Public events, from the customer's side.
 *
 * A separate service from the organizer's on purpose. They answer to different
 * people with different rights, and the one place the two share a code path is
 * the one place a draft event becomes one forgotten `if` away from public.
 *
 * What this service will not do, anywhere:
 *   - return an event that is not published,
 *   - take a price, a total or an organizer id from the caller,
 *   - mint a ticket without a payment this server verified itself.
 */
@Injectable()
export class CustomerPublicEventService implements OnModuleInit {
  private readonly logger = new Logger(CustomerPublicEventService.name);

  onModuleInit(): void {
    if (paymentsTestMode()) {
      this.logger.warn(
        'PAYMENTS_TEST_MODE is ON — paid event tickets confirm WITHOUT payment. Never enable this in production.',
      );
    }
  }

  constructor(
    @InjectModel(PublicEvent.name)
    private readonly eventModel: Model<PublicEventDocument>,
    @InjectModel(EventTicketType.name)
    private readonly typeModel: Model<EventTicketTypeDocument>,
    @InjectModel(EventBooking.name)
    private readonly bookingModel: Model<EventBookingDocument>,
    @InjectModel(EventTicket.name)
    private readonly ticketModel: Model<EventTicketDocument>,
    private readonly events: PublicEventService,
    private readonly payments: PaymentService,
  ) {}

  // -------------------------------------------------------------------------
  // Discovery
  // -------------------------------------------------------------------------

  /**
   * The catalogue.
   *
   * The visibility filter is the first line and is not conditional on anything
   * a caller sends — there is no query parameter, however spelled, that widens
   * it. Everything else only ever narrows what is already public.
   */
  async browse(query: BrowsePublicEventsDto) {
    const filter: FilterQuery<PublicEventDocument> = {
      status: { $in: PUBLIC_STATUSES },
    };

    if (query.q) {
      const safe = query.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { title: { $regex: safe, $options: 'i' } },
        { category: { $regex: safe, $options: 'i' } },
        { 'venue.city': { $regex: safe, $options: 'i' } },
      ];
    }
    if (query.category) filter.category = { $regex: `^${query.category}$`, $options: 'i' };
    if (query.city) filter['venue.city'] = { $regex: `^${query.city}$`, $options: 'i' };

    const limit = query.limit ?? 20;
    const page = query.page ?? 0;

    /*
     * Sorted by when they happen, not by when they were listed. "Soon" is the
     * question a catalogue of events is actually asked, and a list ordered by
     * creation puts next June above tonight.
     */
    const sort: Record<string, 1 | -1> =
      query.sort === 'new' ? { publishedAt: -1 } : { startDateTime: 1 };

    const rows = await this.eventModel
      .find(filter)
      .sort(sort)
      .limit(query.lat !== undefined ? 200 : limit)
      .skip(query.lat !== undefined ? 0 : page * limit)
      .exec();

    /*
     * Distance is filtered here rather than in Mongo because the venue's point
     * is two plain numbers, not a 2dsphere index — adding one is a migration,
     * and this is a catalogue of an organizer's events, not of a city's. The
     * fetch above is capped so "near me" can never become a full scan.
     */
    const near =
      query.lat !== undefined && query.lng !== undefined
        ? rows
            .map((e) => ({ e, km: this.distanceKm(query.lat!, query.lng!, e) }))
            .filter((r) => r.km !== null && r.km <= (query.radiusKm ?? 50))
            .sort((a, b) => (a.km ?? 0) - (b.km ?? 0))
            .slice(page * limit, page * limit + limit)
            .map((r) => r.e)
        : rows;

    const cards = await Promise.all(near.map((e) => this.card(e)));
    if (query.sort === 'price') cards.sort((a, b) => a.startingPrice - b.startingPrice);

    return { items: cards, page, limit };
  }

  private distanceKm(lat: number, lng: number, event: PublicEventDocument): number | null {
    const elat = event.venue?.latitude;
    const elng = event.venue?.longitude;
    if (typeof elat !== 'number' || typeof elng !== 'number') return null;
    const rad = (n: number) => (n * Math.PI) / 180;
    const dLat = rad(elat - lat);
    const dLng = rad(elng - lng);
    const a =
      Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat)) * Math.cos(rad(elat)) * Math.sin(dLng / 2) ** 2;
    return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  /** One row in a list: what a card needs, and nothing the organizer owns. */
  private async card(event: PublicEventDocument) {
    const types = await this.typeModel.find({ event: event._id, archived: false }).exec();
    const now = new Date();
    const buyable = types.filter((t) => isOnSale(event, t, now));
    const prices = buyable.length ? buyable.map((t) => t.price) : types.map((t) => t.price);

    return {
      id: event._id.toString(),
      title: event.title,
      category: event.category,
      coverUrl: event.coverUrl,
      startDateTime: event.startDateTime,
      endDateTime: event.endDateTime,
      timezone: event.timezone,
      venueName: event.venue?.name ?? '',
      city: event.venue?.city ?? '',
      startingPrice: prices.length ? Math.min(...prices) : 0,
      soldOut: event.status === PublicEventStatus.SOLD_OUT || buyable.length === 0,
      status: event.status,
      /* Whether there is a stream at all, and where it is up to. What a
         customer may *watch* is decided when they ask to, not here. */
      liveEnabled: event.liveStream?.enabled === true,
      liveState: liveStateOf(event.liveStream?.startsAt, event.liveStream?.endsAt),
    };
  }

  /**
   * One event, as a customer sees it.
   *
   * Published events only, by the same filter the list uses. A draft 404s here
   * exactly as it does for a stranger guessing ids — the answer that tells an
   * attacker the least is the one that tells them nothing.
   */
  async detail(eventId: string, userId: string | null) {
    if (!Types.ObjectId.isValid(eventId)) throw new NotFoundException('Event not found');
    const event = await this.eventModel
      .findOne({ _id: eventId, status: { $in: PUBLIC_STATUSES } })
      .exec();
    if (!event) throw new NotFoundException('Event not found');

    const now = new Date();
    const types = await this.typeModel
      .find({ event: event._id, archived: false })
      .sort({ price: 1 })
      .exec();

    const standing = userId
      ? await this.standingOf(event._id, userId)
      : { hasTicket: false, checkedIn: false };

    const alreadyHeld = userId ? await this.heldByCustomer(event._id, userId) : new Map();

    return {
      id: event._id.toString(),
      title: event.title,
      category: event.category,
      description: event.description,
      coverUrl: event.coverUrl,
      startDateTime: event.startDateTime,
      endDateTime: event.endDateTime,
      timezone: event.timezone,
      venue: event.venue,
      contactName: event.contactName,
      contactPhone: event.contactPhone,
      contactEmail: event.contactEmail,
      status: event.status,
      soldOut: event.status === PublicEventStatus.SOLD_OUT,
      canBook: isSelling(event),

      ticketTypes: types.map((t) => ({
        id: t._id.toString(),
        name: t.name,
        description: t.description,
        price: t.price,
        onSale: isOnSale(event, t, now),
        /* How many are left is a count; how many *this* customer may take is a
           rule. The screen needs the second, so the server does the arithmetic
           rather than leaving three ceilings to a quantity stepper. */
        available: t.availableQuantity,
        maxForYou: Math.max(
          0,
          perCustomerLimit(event.maxPerCustomer, t.maxPerCustomer, t.availableQuantity) -
            ((alreadyHeld.get(t._id.toString()) as number) ?? 0),
        ),
        salesStart: t.salesStart,
        salesEnd: t.salesEnd,
      })),

      /* Each of these is the server's decision, handed over as a yes or a no.
         The app renders them; it does not compute them, because an app that
         computes its own entitlement is one that can be told to say yes. */
      memories: {
        enabled: event.memories?.enabled === true,
        canView: canAttendeeViewMemories(event, standing),
        canUpload: canAttendeeUpload(event, standing, now),
        canDownload: canAttendeeDownload(event, standing),
      },
      live: {
        enabled: event.liveStream?.enabled === true,
        state: liveStateOf(event.liveStream?.startsAt, event.liveStream?.endsAt),
        access: event.liveStream?.access ?? LiveAccess.TICKETED,
        canWatch: canWatchLive(event, standing),
        replayEnabled: event.liveStream?.replayEnabled === true,
        /* The URL only travels to somebody already entitled to it. Sending it
           with a `canWatch: false` beside it would be handing over the key and
           asking the app not to use it. */
        url: canWatchLive(event, standing) ? (event.liveStream?.url ?? '') : '',
      },

      you: standing,
    };
  }

  /** What this customer holds on this event: a ticket, and whether they came. */
  /** What this customer holds for the event — shared with the memories service. */
  standingFor(eventId: Types.ObjectId, userId: string) {
    return this.standingOf(eventId, userId);
  }

  private async standingOf(eventId: Types.ObjectId, userId: string) {
    /* An ObjectId, not the string from the token: this schema does not cast a
       string here, so the string matched no ticket and every holder read as
       "no ticket" — no gallery, no stream. Every other query in this module
       already converts; this one did not. */
    const customer = new Types.ObjectId(userId);
    const [hasTicket, checkedIn] = await Promise.all([
      this.ticketModel.exists({
        event: eventId,
        customer,
        status: { $in: OCCUPYING_TICKET_STATUSES },
      }),
      this.ticketModel.exists({
        event: eventId,
        customer,
        status: EventTicketStatus.CHECKED_IN,
      }),
    ]);
    return { hasTicket: Boolean(hasTicket), checkedIn: Boolean(checkedIn) };
  }

  /** How many of each type this customer already holds, for the per-person cap. */
  private async heldByCustomer(eventId: Types.ObjectId, userId: string) {
    const rows = await this.bookingModel.aggregate<{ _id: Types.ObjectId; n: number }>([
      {
        $match: {
          event: eventId,
          customer: new Types.ObjectId(userId),
          status: { $in: HOLDING_BOOKING_STATUSES },
        },
      },
      { $group: { _id: '$ticketType', n: { $sum: '$quantity' } } },
    ]);
    return new Map(rows.map((r) => [r._id.toString(), r.n]));
  }

  // -------------------------------------------------------------------------
  // Buying
  // -------------------------------------------------------------------------

  /**
   * Hold the seats and open a payment.
   *
   * The order matters and is the whole design: the seats are taken off the
   * shelf *first*, by the atomic decrement, and only then is the customer sent
   * to pay. Paying first and reserving after is how two people pay for the
   * last ticket, and one of them then has to be refunded and told sorry.
   *
   * Every figure is computed here. The client sends a ticket type and a count;
   * it does not send a price, and there is no field for one.
   */
  async startBooking(userId: string, eventId: string, dto: StartEventBookingDto) {
    if (!Types.ObjectId.isValid(eventId)) throw new NotFoundException('Event not found');

    const event = await this.eventModel
      .findOne({ _id: eventId, status: { $in: PUBLIC_STATUSES } })
      .exec();
    if (!event) throw new NotFoundException('Event not found');
    if (!isSelling(event)) {
      throw new BadRequestException('Tickets for this event are no longer on sale');
    }

    const type = await this.typeModel
      .findOne({ _id: dto.ticketTypeId, event: event._id, archived: false })
      .exec();
    if (!type) throw new NotFoundException('That ticket type is not on this event');

    const now = new Date();
    if (!isOnSale(event, type, now)) {
      throw new BadRequestException('That ticket is not on sale right now');
    }

    /* The per-customer ceiling counts what they already hold, so four bookings
       of one are refused exactly where one booking of four would be. */
    const held = (await this.heldByCustomer(event._id, userId)).get(type._id.toString()) ?? 0;
    const allowance =
      perCustomerLimit(event.maxPerCustomer, type.maxPerCustomer, type.availableQuantity) - held;
    if (dto.quantity > allowance) {
      throw new BadRequestException(
        allowance <= 0
          ? 'You already hold the maximum number of these tickets'
          : `You can take at most ${allowance} more of these`,
      );
    }

    // Atomic. Of two callers racing for the last seat, exactly one gets it.
    await this.events.reserve(type._id, dto.quantity);

    const amount = type.price * dto.quantity;
    const reference = `EVT-${randomBytes(4).toString('hex').toUpperCase()}`;
    /* Free, or a paid ticket under the non-production payments test switch:
       either way there is nothing to collect, so it confirms right here. */
    const testPaid = amount > 0 && paymentsTestMode();
    const settled = amount === 0 || testPaid;

    let booking: EventBookingDocument;
    try {
      booking = await this.bookingModel.create({
        event: event._id,
        organizer: event.organizer,
        customer: new Types.ObjectId(userId),
        ticketType: type._id,
        quantity: dto.quantity,
        unitPrice: type.price,
        amount,
        paymentStatus: settled ? EventPaymentStatus.PAID : EventPaymentStatus.PENDING,
        status: settled ? EventBookingStatus.CONFIRMED : EventBookingStatus.PENDING,
        reference,
        // Marks a test booking for what it is, so it is never mistaken for money.
        ...(testPaid ? { paymentReference: `TEST-${reference}` } : {}),
      });
    } catch (e) {
      /* The seats are already off the shelf. If the booking will not write,
         they go back — otherwise a failed insert silently shrinks the event. */
      await this.events.release(type._id, dto.quantity);
      throw e;
    }

    /*
     * A free ticket has nothing to pay, so it is confirmed here and its
     * tickets are minted now — as is a paid one while payments test mode is
     * on (never in production; see `paymentsTestMode`). Sending somebody to a payment screen for ₹0 is
     * a dead end with a gateway at the bottom of it.
     */
    if (settled) {
      const tickets = await this.mint(booking, event);
      await this.events.refreshSoldOutById(event._id);
      return {
        bookingId: booking._id.toString(),
        reference: booking.reference,
        amount,
        payment: null,
        status: booking.status,
        ticketIds: tickets.map((t) => t._id.toString()),
      };
    }

    let payment: { orderId: string; keyId: string; currency: 'INR' };
    try {
      payment = await this.payments.gatewayOrder(Math.round(amount * 100), booking.reference);
    } catch (e) {
      /* No gateway, no sale — and the seats must not stay held for a checkout
         that was never opened. */
      await this.releaseBooking(booking);
      throw e;
    }

    booking.paymentReference = payment.orderId;
    await booking.save();
    await this.events.refreshSoldOutById(event._id);

    return {
      bookingId: booking._id.toString(),
      reference: booking.reference,
      amount,
      amountInPaise: Math.round(amount * 100),
      payment,
      status: booking.status,
      ticketIds: [],
    };
  }

  /**
   * Confirm a payment and mint the tickets.
   *
   * The signature is checked against Razorpay's own HMAC before anything is
   * written, so a client cannot claim a payment it did not make. Idempotent: a
   * booking already confirmed returns its existing tickets rather than minting
   * a second set, because the app and the webhook both land here.
   */
  async confirmBooking(userId: string, bookingId: string, dto: ConfirmEventBookingDto) {
    if (!Types.ObjectId.isValid(bookingId)) throw new NotFoundException('Booking not found');

    const booking = await this.bookingModel.findById(bookingId).exec();
    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.customer.toString() !== userId) {
      throw new ForbiddenException('This booking is not yours');
    }

    if (booking.status === EventBookingStatus.CONFIRMED) {
      const existing = await this.ticketModel.find({ booking: booking._id }).exec();
      return this.bookingView(booking, existing);
    }

    if (booking.status !== EventBookingStatus.PENDING) {
      throw new BadRequestException(`This booking is ${booking.status}`);
    }

    if (booking.paymentReference && booking.paymentReference !== dto.razorpayOrderId) {
      throw new BadRequestException('That payment belongs to a different booking');
    }

    const ok = this.payments.verifyGatewaySignature(
      dto.razorpayOrderId,
      dto.razorpayPaymentId,
      dto.razorpaySignature,
    );
    if (!ok) {
      booking.paymentStatus = EventPaymentStatus.FAILED;
      await booking.save();
      throw new BadRequestException('We could not verify that payment.');
    }

    const event = await this.eventModel.findById(booking.event).exec();
    if (!event) throw new NotFoundException('Event not found');

    booking.paymentStatus = EventPaymentStatus.PAID;
    booking.status = EventBookingStatus.CONFIRMED;
    booking.paymentReference = dto.razorpayPaymentId;
    await booking.save();

    const tickets = await this.mint(booking, event);
    return this.bookingView(booking, tickets);
  }

  /**
   * One ticket per seat.
   *
   * Four seats bought together are four QRs, because a party that walks in two
   * at a time has to be able to. Each token is 32 random bytes — not derived
   * from the booking, the customer or anything another ticket holder can see.
   */
  private async mint(
    booking: EventBookingDocument,
    event: PublicEventDocument,
  ): Promise<EventTicketDocument[]> {
    const existing = await this.ticketModel.countDocuments({ booking: booking._id });
    if (existing > 0) return this.ticketModel.find({ booking: booking._id }).exec();

    const rows = Array.from({ length: booking.quantity }, () => {
      const { qrToken, code } = this.events.mintCredentials();
      return {
        booking: booking._id,
        event: event._id,
        organizer: event.organizer,
        customer: booking.customer,
        ticketType: booking.ticketType,
        qrToken,
        code,
        status: EventTicketStatus.VALID,
      };
    });

    return this.ticketModel.insertMany(rows);
  }

  /** Give the seats back and mark the booking off. */
  private async releaseBooking(booking: EventBookingDocument): Promise<void> {
    await this.events.release(booking.ticketType, booking.quantity);
    booking.status = EventBookingStatus.CANCELLED;
    await booking.save();
  }

  private bookingView(booking: EventBookingDocument, tickets: EventTicketDocument[]) {
    return {
      bookingId: booking._id.toString(),
      reference: booking.reference,
      status: booking.status,
      paymentStatus: booking.paymentStatus,
      amount: booking.amount,
      quantity: booking.quantity,
      ticketIds: tickets.map((t) => t._id.toString()),
    };
  }

  // -------------------------------------------------------------------------
  // My tickets
  // -------------------------------------------------------------------------

  /**
   * The customer's own tickets.
   *
   * Scoped by customer in the filter, like every other ownership check here.
   * The QR token is not in the list — a list is read on a bus, and a token is
   * the thing that opens a door.
   */
  async myTickets(userId: string, query: ListMyTicketsDto) {
    const limit = query.limit ?? 20;
    const page = query.page ?? 0;

    const filter: FilterQuery<EventTicketDocument> = { customer: new Types.ObjectId(userId) };
    if (query.status === 'checked_in') filter.status = EventTicketStatus.CHECKED_IN;
    if (query.status === 'cancelled') {
      filter.status = { $in: [EventTicketStatus.CANCELLED, EventTicketStatus.REFUNDED] };
    }

    const tickets = await this.ticketModel
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(200)
      .populate('event', 'title coverUrl startDateTime endDateTime timezone venue status')
      .populate('ticketType', 'name price')
      .populate('booking', 'reference status paymentStatus amount')
      .exec();

    const now = new Date();
    const rows = tickets.map((t) => {
      const event = t.event as unknown as Record<string, unknown>;
      const type = t.ticketType as unknown as Record<string, unknown>;
      const booking = t.booking as unknown as Record<string, unknown>;
      const start = event?.startDateTime ? new Date(event.startDateTime as string) : null;
      const end = event?.endDateTime ? new Date(event.endDateTime as string) : start;

      /*
       * The four words the customer is shown, worked out here rather than in
       * the app. "Completed" is a fact about the clock, "checked in" is a fact
       * about the door, and two apps deciding that separately is two apps
       * disagreeing about the same ticket.
       */
      const state: 'upcoming' | 'checked_in' | 'completed' | 'cancelled' =
        t.status === EventTicketStatus.CANCELLED || t.status === EventTicketStatus.REFUNDED
          ? 'cancelled'
          : t.status === EventTicketStatus.CHECKED_IN
            ? 'checked_in'
            : end && now > end
              ? 'completed'
              : 'upcoming';

      return {
        ticketId: t._id.toString(),
        code: t.code,
        state,
        checkedInAt: t.checkedInAt,
        eventId: event?._id ? String(event._id) : '',
        eventTitle: (event?.title as string) ?? '',
        coverUrl: (event?.coverUrl as string) ?? '',
        startDateTime: (event?.startDateTime as Date) ?? null,
        timezone: (event?.timezone as string) ?? 'Asia/Kolkata',
        venueName: ((event?.venue as { name?: string })?.name as string) ?? '',
        city: ((event?.venue as { city?: string })?.city as string) ?? '',
        ticketTypeName: (type?.name as string) ?? '',
        bookingReference: (booking?.reference as string) ?? '',
        paymentStatus: (booking?.paymentStatus as string) ?? '',
      };
    });

    const wanted =
      query.status === 'upcoming' || query.status === 'completed'
        ? rows.filter((r) => r.state === query.status)
        : rows;

    return {
      items: wanted.slice(page * limit, page * limit + limit),
      total: wanted.length,
      page,
      limit,
    };
  }

  /**
   * One ticket, with its QR.
   *
   * The only place a token ever leaves the server, and only to the customer it
   * belongs to — the owner is in the filter, so a ticket id guessed by
   * somebody else matches nothing. `+qrToken` is needed because the schema
   * hides it by default, which is what keeps it out of every other response.
   */
  async ticket(userId: string, ticketId: string) {
    if (!Types.ObjectId.isValid(ticketId)) throw new NotFoundException('Ticket not found');

    const ticket = await this.ticketModel
      .findOne({ _id: ticketId, customer: new Types.ObjectId(userId) })
      .select('+qrToken')
      .populate('event', 'title coverUrl startDateTime endDateTime timezone venue status')
      .populate('ticketType', 'name price')
      .populate('booking', 'reference status paymentStatus amount')
      .populate('customer', 'name')
      .exec();
    if (!ticket) throw new NotFoundException('Ticket not found');

    const event = ticket.event as unknown as Record<string, unknown>;
    const booking = ticket.booking as unknown as Record<string, unknown>;

    /* A cancelled or refunded ticket keeps its page but loses its QR: showing
       a code that will be refused at the door wastes somebody's evening at
       the front of a queue. */
    const live =
      ticket.status === EventTicketStatus.VALID || ticket.status === EventTicketStatus.CHECKED_IN;

    /*
     * The QR is drawn here, not in the app.
     *
     * The token itself therefore never has to reach a client at all — what
     * travels is a picture of it, which is the only thing a door needs. It
     * also means one encoder serves the app, the web and any emailed or
     * printed ticket later, instead of each surface carrying its own.
     */
    const qrSvg = live
      ? await QRCode.toString(ticket.qrToken, {
          type: 'svg',
          errorCorrectionLevel: 'M',
          margin: 1,
        })
      : '';

    return {
      ticketId: ticket._id.toString(),
      code: ticket.code,
      qrSvg,
      status: ticket.status,
      checkedInAt: ticket.checkedInAt,
      customerName: ((ticket.customer as unknown as { name?: string })?.name as string) ?? '',
      eventId: event?._id ? String(event._id) : '',
      eventTitle: (event?.title as string) ?? '',
      coverUrl: (event?.coverUrl as string) ?? '',
      startDateTime: (event?.startDateTime as Date) ?? null,
      endDateTime: (event?.endDateTime as Date) ?? null,
      timezone: (event?.timezone as string) ?? 'Asia/Kolkata',
      venue: (event?.venue as Record<string, unknown>) ?? {},
      ticketTypeName: ((ticket.ticketType as unknown as { name?: string })?.name as string) ?? '',
      bookingReference: (booking?.reference as string) ?? '',
      paymentStatus: (booking?.paymentStatus as string) ?? '',
    };
  }
}

/**
 * Payments test mode: paid tickets confirm without the gateway, for testing
 * the booking flow end to end.
 *
 * Needs PAYMENTS_TEST_MODE=true AND a non-production NODE_ENV. The second
 * check is the safety: a production server ignores the switch even if it is
 * set by mistake, so it can never hand out paid seats for free.
 */
export function paymentsTestMode(): boolean {
  return (
    process.env.PAYMENTS_TEST_MODE === 'true' && (process.env.NODE_ENV ?? 'development') !== 'production'
  );
}
