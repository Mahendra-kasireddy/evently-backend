/**
 * Public Events — the catalogue at the bottom of this module's import stack.
 *
 * Statuses, limits and the pure rules that decide what may follow what. It
 * imports nothing from the module above it, so a schema and a service can both
 * read from here without the circular import that leaves an enum `undefined`
 * at module-init time.
 */

/** Where a public event is in its life. */
export enum PublicEventStatus {
  /** The organizer is still writing it. Nobody else can see it at all. */
  DRAFT = 'draft',
  /** Live in the catalogue; tickets may be sold. */
  PUBLISHED = 'published',
  /** Published, but every ticket type is exhausted. Derived, never set by hand. */
  SOLD_OUT = 'sold_out',
  /** The event has happened. Sales are closed; records stay readable. */
  COMPLETED = 'completed',
  /** Called off. Sales closed, and the reason is kept for the attendees. */
  CANCELLED = 'cancelled',
}

/** Whether a ticket type is on sale, quite apart from whether any are left. */
export enum TicketTypeStatus {
  ACTIVE = 'active',
  PAUSED = 'paused',
}

/** What the customer has settled for one booking. */
export enum EventPaymentStatus {
  PENDING = 'pending',
  PAID = 'paid',
  FAILED = 'failed',
  REFUNDED = 'refunded',
}

/** Where one booking stands, quite apart from the money. */
export enum EventBookingStatus {
  /** Created, holding inventory, waiting on the gateway. */
  PENDING = 'pending',
  /** Paid for. Tickets exist. */
  CONFIRMED = 'confirmed',
  /** Called off before the event, by either side. */
  CANCELLED = 'cancelled',
  /** Money returned. */
  REFUNDED = 'refunded',
}

/** One ticket, which is one seat and one QR. */
export enum EventTicketStatus {
  VALID = 'valid',
  CHECKED_IN = 'checked_in',
  CANCELLED = 'cancelled',
  REFUNDED = 'refunded',
}

/** What a scan at the door comes back with. */
export enum CheckInResult {
  ALLOWED = 'entry_allowed',
  ALREADY = 'already_checked_in',
  INVALID = 'invalid_ticket',
}

/** How a live stream is reached. */
export enum LiveAccess {
  /** Anyone who can see the event. */
  FREE = 'free',
  /** Only a confirmed ticket holder. */
  TICKETED = 'ticketed',
}

/** Where the stream is in its own life. Derived from the clock and the flag. */
export enum LiveState {
  UPCOMING = 'upcoming',
  LIVE = 'live',
  ENDED = 'ended',
}

/**
 * Who may upload to a public event's shared memories.
 *
 * `CHECKED_IN` is the recommended default for a paid event: the people in the
 * room are the people with photographs of it, and it keeps the gallery from
 * becoming a place anyone with the link can post to.
 */
export enum MemoryUploaders {
  CHECKED_IN = 'checked_in',
  TICKET_HOLDERS = 'ticket_holders',
  NOBODY = 'nobody',
}

// ---------------------------------------------------------------------------
// Limits. Named here so a DTO, a schema and a test all quote the same number.
// ---------------------------------------------------------------------------

export const EVENT_TITLE_MAX = 120;
export const EVENT_DESCRIPTION_MAX = 4000;
export const EVENT_CATEGORY_MAX = 60;
export const EVENT_VENUE_MAX = 160;
export const EVENT_ADDRESS_MAX = 400;
export const EVENT_CITY_MAX = 80;
export const EVENT_CONTACT_MAX = 120;
export const EVENT_TIMEZONE_MAX = 64;
export const EVENT_CAPACITY_MAX = 1_000_000;
export const TICKET_NAME_MAX = 80;
export const TICKET_DESCRIPTION_MAX = 500;
export const TICKET_PRICE_MAX = 10_000_000;
export const TICKET_QUANTITY_MAX = 1_000_000;
export const TICKET_PER_CUSTOMER_MAX = 50;
export const CANCEL_REASON_MAX = 500;
export const LIVE_URL_MAX = 500;

/** The ticket statuses that still occupy a seat. */
export const OCCUPYING_TICKET_STATUSES = [EventTicketStatus.VALID, EventTicketStatus.CHECKED_IN];

/** The booking statuses that still hold inventory. */
export const HOLDING_BOOKING_STATUSES = [EventBookingStatus.PENDING, EventBookingStatus.CONFIRMED];

/** Statuses in which the event is visible to anybody but its organizer. */
export const PUBLIC_STATUSES = [
  PublicEventStatus.PUBLISHED,
  PublicEventStatus.SOLD_OUT,
  PublicEventStatus.COMPLETED,
];

/** Statuses in which tickets may still be sold. */
export const SELLING_STATUSES = [PublicEventStatus.PUBLISHED];

/**
 * What an organizer may move an event to, from where.
 *
 * Written down rather than checked inline at each endpoint: "can this be
 * published?" is asked by the publish route, the edit route and the dashboard,
 * and three copies of the answer is how they come to disagree.
 *
 * SOLD_OUT is not reachable by hand — it is what the inventory says — so it
 * is never a destination here, only a place to leave.
 */
export const ALLOWED_TRANSITIONS: Record<PublicEventStatus, PublicEventStatus[]> = {
  [PublicEventStatus.DRAFT]: [PublicEventStatus.PUBLISHED, PublicEventStatus.CANCELLED],
  [PublicEventStatus.PUBLISHED]: [
    PublicEventStatus.DRAFT,
    PublicEventStatus.COMPLETED,
    PublicEventStatus.CANCELLED,
  ],
  [PublicEventStatus.SOLD_OUT]: [
    PublicEventStatus.DRAFT,
    PublicEventStatus.COMPLETED,
    PublicEventStatus.CANCELLED,
  ],
  /* Terminal. An event that has happened or been called off is history, and
     history is not edited back into the catalogue. */
  [PublicEventStatus.COMPLETED]: [],
  [PublicEventStatus.CANCELLED]: [],
};

/** Whether an organizer may take `from` to `to`. */
export function canTransition(from: PublicEventStatus, to: PublicEventStatus): boolean {
  return (ALLOWED_TRANSITIONS[from] ?? []).includes(to);
}

/**
 * Where the stream stands, from the clock rather than from a field somebody
 * has to remember to change.
 */
export function liveStateOf(
  startsAt: Date | null | undefined,
  endsAt: Date | null | undefined,
  now: Date = new Date(),
): LiveState {
  const start = startsAt ? startsAt.getTime() : null;
  const end = endsAt ? endsAt.getTime() : null;
  const at = now.getTime();
  if (end !== null && at > end) return LiveState.ENDED;
  if (start !== null && at >= start) return LiveState.LIVE;
  return LiveState.UPCOMING;
}

/**
 * A ticket type's sales window, as a yes or no at this instant.
 *
 * Both ends are optional: a type with no window is on sale for as long as the
 * event is.
 */
export function withinSalesWindow(
  salesStart: Date | null | undefined,
  salesEnd: Date | null | undefined,
  now: Date = new Date(),
): boolean {
  const at = now.getTime();
  if (salesStart && at < salesStart.getTime()) return false;
  if (salesEnd && at > salesEnd.getTime()) return false;
  return true;
}
