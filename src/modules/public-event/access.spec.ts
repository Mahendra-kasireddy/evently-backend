import {
  EventBookingStatus,
  EventTicketStatus,
  LiveAccess,
  MemoryUploaders,
  PublicEventStatus,
  TicketTypeStatus,
  canTransition,
  liveStateOf,
  withinSalesWindow,
} from './public-event.constants';
import {
  EventLike,
  TicketTypeLike,
  canAttendeeDownload,
  canAttendeeUpload,
  canAttendeeViewMemories,
  canWatchLive,
  isAdmittable,
  isCheckInOpen,
  isOnSale,
  isPubliclyVisible,
  isSoldOut,
  memoryUploadDeadline,
  perCustomerLimit,
} from './access';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const event = (over: Partial<EventLike> = {}): EventLike => ({
  status: PublicEventStatus.PUBLISHED,
  startDateTime: new Date('2026-10-01T10:00:00.000Z'),
  endDateTime: new Date('2026-10-01T18:00:00.000Z'),
  ...over,
});

const type = (over: Partial<TicketTypeLike> = {}): TicketTypeLike => ({
  status: TicketTypeStatus.ACTIVE,
  archived: false,
  availableQuantity: 10,
  salesStart: null,
  salesEnd: null,
  ...over,
});

describe('who can see an event at all', () => {
  it('keeps a draft out of the catalogue', () => {
    expect(isPubliclyVisible(event({ status: PublicEventStatus.DRAFT }))).toBe(false);
  });

  it('leaves a finished event readable — people were there, and hold tickets', () => {
    expect(isPubliclyVisible(event({ status: PublicEventStatus.COMPLETED }))).toBe(true);
  });
});

describe('whether a ticket can be bought', () => {
  const now = new Date('2026-09-20T12:00:00.000Z');

  it('refuses while the event is still a draft, whatever the stock says', () => {
    expect(isOnSale(event({ status: PublicEventStatus.DRAFT }), type(), now)).toBe(false);
  });

  it('refuses a paused type that still has seats', () => {
    expect(isOnSale(event(), type({ status: TicketTypeStatus.PAUSED }), now)).toBe(false);
  });

  /*
   * Four separate reasons a ticket might not be buyable, and they are not
   * interchangeable: a screen that only checks the stock tells a customer
   * "sold out" about a ticket that goes on sale on Friday.
   */
  it('refuses before the window opens and after it closes, with seats left either way', () => {
    const early = type({ salesStart: new Date('2026-09-25T00:00:00.000Z') });
    const late = type({ salesEnd: new Date('2026-09-10T00:00:00.000Z') });
    expect(isOnSale(event(), early, now)).toBe(false);
    expect(isOnSale(event(), late, now)).toBe(false);
    expect(early.availableQuantity).toBeGreaterThan(0);
    expect(late.availableQuantity).toBeGreaterThan(0);
  });

  it('refuses an archived type even while it is active and stocked', () => {
    expect(isOnSale(event(), type({ archived: true }), now)).toBe(false);
  });

  it('allows an open, stocked, in-window type', () => {
    expect(isOnSale(event(), type(), now)).toBe(true);
  });
});

describe('the sales window', () => {
  const at = new Date('2026-09-20T12:00:00.000Z');

  it('is open when neither end is set', () => {
    expect(withinSalesWindow(null, null, at)).toBe(true);
  });

  it('is open on an open-ended window that has started', () => {
    expect(withinSalesWindow(new Date('2026-09-01T00:00:00.000Z'), null, at)).toBe(true);
  });
});

describe('sold out', () => {
  it('is not what an event with no ticket types is', () => {
    // It is unfinished. Saying "sold out" would be a lie told to everyone who
    // found it, and it would hide the organizer's actual mistake.
    expect(isSoldOut(event(), [])).toBe(false);
  });

  it('is true only when every live type is gone', () => {
    const some = [type({ availableQuantity: 0 }), type({ availableQuantity: 3 })];
    const none = [type({ availableQuantity: 0 }), type({ availableQuantity: 0 })];
    expect(isSoldOut(event(), some)).toBe(false);
    expect(isSoldOut(event(), none)).toBe(true);
  });

  it('ignores archived and paused types when deciding', () => {
    const rows = [
      type({ availableQuantity: 0 }),
      type({ availableQuantity: 50, archived: true }),
      type({ availableQuantity: 50, status: TicketTypeStatus.PAUSED }),
    ];
    // The only type anybody can buy has run out, so the event has.
    expect(isSoldOut(event(), rows)).toBe(true);
  });
});

describe('how many one customer may take', () => {
  it('is what is left when neither ceiling is set', () => {
    expect(perCustomerLimit(0, 0, 7)).toBe(7);
  });

  it('takes the narrower ceiling when both are set', () => {
    expect(perCustomerLimit(10, 4, 50)).toBe(4);
    expect(perCustomerLimit(3, 8, 50)).toBe(3);
  });

  /*
   * 0 means "no ceiling of mine", not "none allowed". Math.min across both
   * would turn an event with no limit into an event that sells nothing.
   */
  it('reads a zero as no ceiling rather than a ceiling of zero', () => {
    expect(perCustomerLimit(0, 5, 50)).toBe(5);
    expect(perCustomerLimit(5, 0, 50)).toBe(5);
  });

  it('never offers more than is actually left', () => {
    expect(perCustomerLimit(10, 10, 2)).toBe(2);
  });
});

describe('who may add to the gallery', () => {
  const holder = { hasTicket: true, checkedIn: false };
  const attended = { hasTicket: true, checkedIn: true };
  const stranger = { hasTicket: false, checkedIn: false };
  const during = new Date('2026-10-01T12:00:00.000Z');

  it('nobody, while memories are switched off', () => {
    const off = event({ memories: { enabled: false } });
    expect(canAttendeeUpload(off, attended, during)).toBe(false);
  });

  it('only the people who came, on the recommended setting for a paid event', () => {
    const e = event({ memories: { enabled: true, uploaders: MemoryUploaders.CHECKED_IN } });
    expect(canAttendeeUpload(e, attended, during)).toBe(true);
    expect(canAttendeeUpload(e, holder, during)).toBe(false);
    expect(canAttendeeUpload(e, stranger, during)).toBe(false);
  });

  it('anyone holding a ticket, when the organizer opens it that far', () => {
    const e = event({ memories: { enabled: true, uploaders: MemoryUploaders.TICKET_HOLDERS } });
    expect(canAttendeeUpload(e, holder, during)).toBe(true);
    expect(canAttendeeUpload(e, stranger, during)).toBe(false);
  });

  it('nobody once the window has closed, however well they qualify', () => {
    const e = event({
      memories: { enabled: true, uploaders: MemoryUploaders.CHECKED_IN, uploadWindowDays: 2 },
    });
    const late = new Date(memoryUploadDeadline(e).getTime() + HOUR);
    expect(canAttendeeUpload(e, attended, late)).toBe(false);
  });

  it('counts the window from the end of the event, not its start', () => {
    const e = event({ memories: { enabled: true, uploadWindowDays: 1 } });
    expect(memoryUploadDeadline(e).getTime()).toBe((e.endDateTime as Date).getTime() + DAY);
  });

  it('nobody, once the event is cancelled', () => {
    const e = event({ status: PublicEventStatus.CANCELLED, memories: { enabled: true } });
    expect(canAttendeeUpload(e, attended, during)).toBe(false);
  });
});

describe('who may see and keep the gallery', () => {
  const attended = { hasTicket: true, checkedIn: true };
  const stranger = { hasTicket: false, checkedIn: false };

  it('is shut to somebody with no ticket', () => {
    const e = event({ memories: { enabled: true, attendeeView: true } });
    expect(canAttendeeViewMemories(e, stranger)).toBe(false);
  });

  it('downloads need their own switch, not just the right to look', () => {
    const lookOnly = event({ memories: { enabled: true, attendeeView: true } });
    expect(canAttendeeViewMemories(lookOnly, attended)).toBe(true);
    expect(canAttendeeDownload(lookOnly, attended)).toBe(false);
  });

  it('cannot be downloaded by somebody who cannot even view it', () => {
    const e = event({
      memories: { enabled: true, attendeeView: false, attendeeDownload: true },
    });
    expect(canAttendeeDownload(e, attended)).toBe(false);
  });
});

describe('who may watch the stream', () => {
  const holder = { hasTicket: true, checkedIn: false };
  const stranger = { hasTicket: false, checkedIn: false };

  it('a free stream is open to anyone who can see the event', () => {
    const e = event({ liveStream: { enabled: true, access: LiveAccess.FREE } });
    expect(canWatchLive(e, stranger)).toBe(true);
  });

  it('a ticketed stream wants a ticket', () => {
    const e = event({ liveStream: { enabled: true, access: LiveAccess.TICKETED } });
    expect(canWatchLive(e, holder)).toBe(true);
    expect(canWatchLive(e, stranger)).toBe(false);
  });

  it('nobody watches a draft event, free stream or not', () => {
    const e = event({
      status: PublicEventStatus.DRAFT,
      liveStream: { enabled: true, access: LiveAccess.FREE },
    });
    expect(canWatchLive(e, holder)).toBe(false);
  });
});

describe('the state of a stream', () => {
  it('reads from the clock rather than a flag somebody has to remember', () => {
    const start = new Date('2026-10-01T10:00:00.000Z');
    const end = new Date('2026-10-01T12:00:00.000Z');
    expect(liveStateOf(start, end, new Date('2026-10-01T09:00:00.000Z'))).toBe('upcoming');
    expect(liveStateOf(start, end, new Date('2026-10-01T11:00:00.000Z'))).toBe('live');
    expect(liveStateOf(start, end, new Date('2026-10-01T13:00:00.000Z'))).toBe('ended');
  });

  it('is upcoming when no times have been set at all', () => {
    expect(liveStateOf(null, null)).toBe('upcoming');
  });
});

describe('the door', () => {
  it('admits only a valid ticket on a confirmed booking', () => {
    expect(isAdmittable(EventTicketStatus.VALID, EventBookingStatus.CONFIRMED)).toBe(true);
    expect(isAdmittable(EventTicketStatus.VALID, EventBookingStatus.PENDING)).toBe(false);
    expect(isAdmittable(EventTicketStatus.CHECKED_IN, EventBookingStatus.CONFIRMED)).toBe(false);
    expect(isAdmittable(EventTicketStatus.REFUNDED, EventBookingStatus.CONFIRMED)).toBe(false);
  });

  it('is shut on a draft event and on a cancelled one', () => {
    expect(isCheckInOpen(event({ status: PublicEventStatus.DRAFT }))).toBe(false);
    expect(isCheckInOpen(event({ status: PublicEventStatus.CANCELLED }))).toBe(false);
    expect(isCheckInOpen(event({ status: PublicEventStatus.PUBLISHED }))).toBe(true);
    // Late arrivals at an event already marked finished still get in.
    expect(isCheckInOpen(event({ status: PublicEventStatus.COMPLETED }))).toBe(true);
  });
});

describe('what an organizer may change an event into', () => {
  it('lets a draft go live and a live event come back', () => {
    expect(canTransition(PublicEventStatus.DRAFT, PublicEventStatus.PUBLISHED)).toBe(true);
    expect(canTransition(PublicEventStatus.PUBLISHED, PublicEventStatus.DRAFT)).toBe(true);
  });

  it('will not reopen history', () => {
    expect(canTransition(PublicEventStatus.COMPLETED, PublicEventStatus.PUBLISHED)).toBe(false);
    expect(canTransition(PublicEventStatus.CANCELLED, PublicEventStatus.PUBLISHED)).toBe(false);
    expect(canTransition(PublicEventStatus.CANCELLED, PublicEventStatus.DRAFT)).toBe(false);
  });

  /* SOLD_OUT is what the stock says, never something an organizer declares —
     so it is a place to leave, and never a destination. */
  it('offers no way to declare an event sold out by hand', () => {
    for (const from of Object.values(PublicEventStatus)) {
      expect(canTransition(from, PublicEventStatus.SOLD_OUT)).toBe(false);
    }
  });
});
