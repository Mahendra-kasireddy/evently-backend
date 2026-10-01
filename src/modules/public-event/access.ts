/**
 * The access decisions for public events, as plain functions.
 *
 * Pulled out of the service so each one can be read, argued with and tested on
 * its own, without a database. Every rule here is about what somebody may do;
 * none of them touches Mongo, and none of them trusts an argument it was not
 * given by the server.
 */
import {
  EventBookingStatus,
  EventTicketStatus,
  LiveAccess,
  MemoryUploaders,
  PUBLIC_STATUSES,
  PublicEventStatus,
  SELLING_STATUSES,
  TicketTypeStatus,
  withinSalesWindow,
} from './public-event.constants';

/** The slice of an event these rules need. */
export interface EventLike {
  status: PublicEventStatus;
  startDateTime: Date;
  endDateTime?: Date | null;
  memories?: {
    enabled?: boolean;
    uploaders?: MemoryUploaders;
    attendeeView?: boolean;
    attendeeDownload?: boolean;
    uploadWindowDays?: number;
  };
  liveStream?: { enabled?: boolean; access?: LiveAccess };
}

/** The slice of a ticket type these rules need. */
export interface TicketTypeLike {
  status: TicketTypeStatus;
  archived: boolean;
  /** Seats it was created with. Absent on older callers, read as "had some". */
  totalQuantity?: number;
  availableQuantity: number;
  salesStart?: Date | null;
  salesEnd?: Date | null;
  maxPerCustomer?: number;
}

/** Whether anybody but the organizer may see this event at all. */
export function isPubliclyVisible(event: EventLike): boolean {
  return PUBLIC_STATUSES.includes(event.status);
}

/** Whether the event is in a state where tickets may change hands. */
export function isSelling(event: EventLike): boolean {
  return SELLING_STATUSES.includes(event.status);
}

/**
 * Whether this type can be bought right now.
 *
 * Four separate reasons it might not be, deliberately all checked: the type is
 * retired, the organizer paused it, its window has not opened or has closed,
 * or it is simply sold out. A screen that only checks the last one tells a
 * customer "sold out" about a ticket that goes on sale on Friday.
 */
export function isOnSale(event: EventLike, type: TicketTypeLike, now: Date = new Date()): boolean {
  if (!isSelling(event)) return false;
  if (type.archived) return false;
  if (type.status !== TicketTypeStatus.ACTIVE) return false;
  if (!withinSalesWindow(type.salesStart, type.salesEnd, now)) return false;
  return type.availableQuantity > 0;
}

/**
 * The most tickets of this type one customer may take, counting what they
 * already hold.
 *
 * The narrower of the type's own ceiling and the event's, and never more than
 * is left. 0 on either means "no ceiling of mine" rather than "none allowed",
 * which is why neither can simply be `Math.min`-ed in.
 */
export function perCustomerLimit(
  eventMax: number | undefined,
  typeMax: number | undefined,
  available: number,
): number {
  const ceilings = [eventMax, typeMax].filter((n): n is number => typeof n === 'number' && n > 0);
  if (ceilings.length === 0) return available;
  return Math.max(0, Math.min(Math.min(...ceilings), available));
}

/**
 * Whether an event is sold out: every ticket type that ever had seats has
 * none left.
 *
 * Only stock decides it. A sales window that has not opened, or has closed, is
 * not "sold out" — the seats are still there — and telling customers otherwise
 * is false. A type created with no seats is a setup mistake, not a sell-out,
 * so it does not count; and an event with no such types at all is unfinished.
 */
export function isSoldOut(_event: EventLike, types: TicketTypeLike[]): boolean {
  const stocked = types.filter(
    (t) =>
      !t.archived &&
      t.status === TicketTypeStatus.ACTIVE &&
      (t.totalQuantity === undefined || t.totalQuantity > 0),
  );
  if (stocked.length === 0) return false;
  return stocked.every((t) => t.availableQuantity <= 0);
}

/** Where an event's ticket sales stand, as the customer is told it. */
export type SaleState = 'on_sale' | 'sold_out' | 'upcoming' | 'closed' | 'unavailable';

/**
 * The one word for whether, and when, tickets can be bought.
 *
 * - on_sale: at least one ticket can be bought now.
 * - sold_out: every stocked type has run out.
 * - upcoming: seats exist and a sales window opens later (`opensAt`).
 * - closed: seats exist but every window has ended, or the event has stopped
 *   selling.
 * - unavailable: nothing is set up to sell — no stocked, active type.
 */
export function saleStateOf(
  event: EventLike,
  types: TicketTypeLike[],
  now: Date = new Date(),
): { state: SaleState; opensAt: Date | null } {
  if (isSoldOut(event, types)) return { state: 'sold_out', opensAt: null };
  if (types.some((t) => isOnSale(event, t, now))) return { state: 'on_sale', opensAt: null };

  const stocked = types.filter(
    (t) =>
      !t.archived &&
      t.status === TicketTypeStatus.ACTIVE &&
      t.availableQuantity > 0,
  );
  if (stocked.length === 0) return { state: 'unavailable', opensAt: null };

  const opens = stocked
    .map((t) => t.salesStart)
    .filter((d): d is Date => d instanceof Date && d > now)
    .sort((a, b) => a.getTime() - b.getTime());
  if (opens.length > 0 && isSelling(event)) return { state: 'upcoming', opensAt: opens[0] };
  return { state: 'closed', opensAt: null };
}

/** The last instant an attendee may add to the gallery. */
export function memoryUploadDeadline(event: EventLike): Date {
  const base = event.endDateTime ?? event.startDateTime;
  const days = event.memories?.uploadWindowDays ?? 7;
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
}

/** What one attendee holds, as far as the memory rules are concerned. */
export interface AttendeeStanding {
  hasTicket: boolean;
  checkedIn: boolean;
}

/**
 * Whether this attendee may add to the gallery.
 *
 * Decided here rather than by hiding a button: an app that only hides the
 * camera is an app whose upload endpoint anyone can still call.
 */
export function canAttendeeUpload(
  event: EventLike,
  who: AttendeeStanding,
  now: Date = new Date(),
): boolean {
  if (!event.memories?.enabled) return false;
  if (event.status === PublicEventStatus.CANCELLED) return false;
  if (now > memoryUploadDeadline(event)) return false;

  switch (event.memories.uploaders ?? MemoryUploaders.CHECKED_IN) {
    case MemoryUploaders.NOBODY:
      return false;
    case MemoryUploaders.TICKET_HOLDERS:
      return who.hasTicket;
    case MemoryUploaders.CHECKED_IN:
    default:
      return who.checkedIn;
  }
}

/** Whether this attendee may see the gallery at all. */
export function canAttendeeViewMemories(event: EventLike, who: AttendeeStanding): boolean {
  if (!event.memories?.enabled) return false;
  if (!(event.memories.attendeeView ?? true)) return false;
  return who.hasTicket || who.checkedIn;
}

/** Whether this attendee may take a copy away. */
export function canAttendeeDownload(event: EventLike, who: AttendeeStanding): boolean {
  if (!canAttendeeViewMemories(event, who)) return false;
  return event.memories?.attendeeDownload === true;
}

/**
 * Whether this attendee may watch the stream.
 *
 * A free stream is open to anybody who can see the event; a ticketed one wants
 * a ticket. Evently decides this, not the streaming provider — the provider
 * only ever receives somebody we have already let through.
 */
export function canWatchLive(event: EventLike, who: AttendeeStanding): boolean {
  if (!event.liveStream?.enabled) return false;
  if (!isPubliclyVisible(event)) return false;
  if ((event.liveStream.access ?? LiveAccess.TICKETED) === LiveAccess.FREE) return true;
  return who.hasTicket;
}

/** A ticket that may still be walked through the door. */
export function isAdmittable(
  ticketStatus: EventTicketStatus,
  bookingStatus: EventBookingStatus,
): boolean {
  return ticketStatus === EventTicketStatus.VALID && bookingStatus === EventBookingStatus.CONFIRMED;
}

/**
 * Whether the door is open at all.
 *
 * A draft event has no door, and a cancelled one's door is shut however valid
 * the ticket in somebody's hand is.
 */
export function isCheckInOpen(event: EventLike): boolean {
  return (
    event.status === PublicEventStatus.PUBLISHED ||
    event.status === PublicEventStatus.SOLD_OUT ||
    event.status === PublicEventStatus.COMPLETED
  );
}
