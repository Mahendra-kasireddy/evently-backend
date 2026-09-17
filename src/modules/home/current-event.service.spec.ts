import { Types } from 'mongoose';
import { CurrentEventService, CurrentEventStage } from './current-event.service';
import { QuoteRequestStatus } from '../quote/schemas/quote-request.schema';
import { BookingStatus } from '../booking/schemas/booking.schema';
import { PlanStatus } from '../plan/schemas/plan-submission.schema';

/**
 * Which of a customer's events Home shows.
 *
 * The rule that matters here: ranking decides the ORDER, never who is allowed
 * on screen. A confirmed booking for December used to silently cover a brief
 * still collecting quotes for September — two real events, one card, and no
 * sign from Home that the second existed.
 *
 * The other half is the opposite failure: the same event exists as a plan, a
 * brief and a booking, and showing all three would be three cards for one
 * party. So each test below is either "do not hide a second event" or "do not
 * show one event twice".
 */

const PLAN_ID = new Types.ObjectId();

const plan = (over: Record<string, unknown> = {}) =>
  ({
    _id: PLAN_ID,
    status: PlanStatus.SUBMITTED,
    occasion: 'naming',
    eventDate: new Date('2026-09-05'),
    area: 'Kukatpally',
    city: 'Hyderabad',
    guests: '150',
    planCode: 'PLN-1',
    ...over,
  }) as never;

const brief = (over: Record<string, unknown> = {}) =>
  ({
    id: 'req1',
    occasion: 'naming',
    when: '5 Sep 2026',
    where: 'Kukatpally',
    guests: '150',
    status: QuoteRequestStatus.QUOTED,
    quoteCount: 3,
    lowestQuote: 625000,
    highestQuote: 742000,
    acceptedQuotationId: null,
    organizer: null,
    quotes: [],
    sentToCount: 4,
    awaiting: [],
    closesInDays: 4,
    planId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  }) as never;

const booking = (over: Record<string, unknown> = {}) =>
  ({
    id: 'bk1',
    ref: 'EVT-2026-1977',
    title: 'Anniversary',
    description: '',
    occasion: 'anniversary',
    location: 'Jubilee Hills',
    eventDate: new Date('2026-12-28'),
    guests: '80',
    progress: 82,
    daysToGo: 30,
    steps: [],
    status: BookingStatus.CONFIRMED,
    organizer: null,
    requestId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  }) as never;

/**
 * A service over stubbed modules.
 *
 * `existsForRequest` defaults to false so an ACCEPTED brief is only dropped
 * when a test says a booking really came from it.
 */
function serviceWith({
  latestPlan = null,
  latestBrief = null,
  latestBooking = null,
  activePlans,
  activeBriefs,
  liveBookings,
  bookedFromRequest = false,
  unread = 0,
}: {
  /* The three singular options are shorthand — most cases only need one of
     each, and reading `latestBooking: booking()` says so more plainly than a
     one-element array. The plural ones are for the cases that are about there
     being several. */
  latestPlan?: unknown;
  latestBrief?: unknown;
  latestBooking?: unknown;
  activePlans?: unknown[];
  activeBriefs?: unknown[];
  liveBookings?: unknown[];
  bookedFromRequest?: boolean;
  unread?: number;
} = {}) {
  const one = (single: unknown) => (single ? [single] : []);
  const plans = activePlans ?? one(latestPlan);
  const briefs = activeBriefs ?? one(latestBrief);
  const bookings = liveBookings ?? one(latestBooking);
  return new CurrentEventService(
    { getAllActiveForUser: jest.fn().mockResolvedValue(plans) } as never,
    { getAllActiveForUser: jest.fn().mockResolvedValue(briefs) } as never,
    {
      getAllLiveForUser: jest.fn().mockResolvedValue(bookings),
      existsForRequest: jest.fn().mockResolvedValue(bookedFromRequest),
    } as never,
    { unreadCount: jest.fn().mockResolvedValue(unread) } as never,
  );
}

const USER = new Types.ObjectId().toString();

describe('showing every live event', () => {
  it('keeps a brief that a further-along booking outranks', async () => {
    // The reported bug, exactly: a confirmed booking and a separate brief.
    const events = await serviceWith({
      latestBooking: booking(),
      latestBrief: brief(),
    }).resolveAll(USER);

    expect(events).toHaveLength(2);
    expect(events.map((e) => e.stage)).toEqual([
      CurrentEventStage.BOOKING_CONFIRMED,
      CurrentEventStage.QUOTES_RECEIVED,
    ]);
  });

  it('puts the furthest along first', async () => {
    const events = await serviceWith({
      latestBooking: booking(),
      latestBrief: brief(),
      latestPlan: plan(),
    }).resolveAll(USER);

    expect(events.map((e) => e.rank)).toEqual([...events.map((e) => e.rank)].sort((a, b) => b - a));
  });

  it('still gives the hero the same single event it always did', async () => {
    // resolve() is what Home's big card reads; it must not have changed.
    const current = await serviceWith({
      latestBooking: booking(),
      latestBrief: brief(),
    }).resolve(USER);

    expect(current?.source).toBe('booking');
  });

  it('badges the card the customer sees first', async () => {
    const events = await serviceWith({
      latestBooking: booking(),
      latestBrief: brief(),
      unread: 2,
    }).resolveAll(USER);

    expect(events[0].hasNewActivity).toBe(true);
    expect(events[1].hasNewActivity).toBe(false);
  });

  it('has nothing to show for an account with nothing on', async () => {
    expect(await serviceWith().resolveAll(USER)).toEqual([]);
    expect(await serviceWith().resolve(USER)).toBeNull();
  });
});

describe('every booking the customer has', () => {
  /*
   * The reported bug. `getLatestForUser` was a `findOne`, so a customer with
   * three confirmed bookings had two of them invisible on Home — not ranked
   * below something, not collapsed into a card: never sent at all.
   */
  it('returns one event per live booking', async () => {
    const events = await serviceWith({
      liveBookings: [
        booking({ id: 'bk1', title: 'Anniversary' }),
        booking({ id: 'bk2', title: 'Naming ceremony' }),
        booking({ id: 'bk3', title: 'Housewarming' }),
      ],
    }).resolveAll(USER);

    expect(events.map((e) => e.title)).toEqual(['Anniversary', 'Naming ceremony', 'Housewarming']);
    expect(events.every((e) => e.source === 'booking')).toBe(true);
  });

  it('keeps them newest first, the order they arrived in', async () => {
    // The sort is by stage rank and stable, so bookings on one rank hold the
    // order the query returned — which is `createdAt` descending.
    const events = await serviceWith({
      liveBookings: [
        booking({ id: 'bk1', title: 'Newest' }),
        booking({ id: 'bk2', title: 'Older' }),
      ],
    }).resolveAll(USER);

    expect(events.map((e) => e.title)).toEqual(['Newest', 'Older']);
  });

  it('drops a brief that any of them was made from, not just the newest', async () => {
    // The dedupe used to compare against one booking. With several, a brief
    // booked through an older one came back as a second card for one event.
    const events = await serviceWith({
      liveBookings: [
        booking({ id: 'bk1', requestId: 'req-other' }),
        booking({ id: 'bk2', requestId: 'req1' }),
      ],
      latestBrief: brief({ id: 'req1' }),
    }).resolveAll(USER);

    expect(events.filter((e) => e.source === 'quote')).toEqual([]);
    expect(events).toHaveLength(2);
  });

  it('still shows the hero the furthest-along one', async () => {
    const service = serviceWith({
      liveBookings: [booking({ id: 'bk1', title: 'Anniversary' }), booking({ id: 'bk2' })],
    });
    expect((await service.resolve(USER))?.title).toBe('Anniversary');
  });
});

describe('every brief and plan the customer has', () => {
  /*
   * What the customer reported: "I created event plans and submitted
   * requests — none of those records are showing." Both resolvers were
   * `findOne`, so every account was capped at one plan and one brief no matter
   * how many it had.
   */
  it('returns one event per active brief', async () => {
    const events = await serviceWith({
      activeBriefs: [
        brief({ id: 'req1', occasion: 'Corporate' }),
        brief({ id: 'req2', occasion: 'Wedding' }),
        brief({ id: 'req3', occasion: 'Naming' }),
      ],
    }).resolveAll(USER);

    expect(events).toHaveLength(3);
    expect(events.every((e) => e.source === 'quote')).toBe(true);
  });

  it('returns one event per active plan', async () => {
    const events = await serviceWith({
      activePlans: [plan({ _id: 'p1' }), plan({ _id: 'p2' })],
    }).resolveAll(USER);

    expect(events).toHaveLength(2);
    expect(events.every((e) => e.source === 'plan')).toBe(true);
  });

  it('drops only the plans their own brief covers', async () => {
    /*
     * The dedupe used to compare one plan against one brief. Across lists it
     * has to match them up: a customer with two plans, one of which became a
     * brief, has two events — the brief and the untouched plan — not one, and
     * not three.
     */
    const events = await serviceWith({
      activePlans: [plan({ _id: 'p1' }), plan({ _id: 'p2' })],
      activeBriefs: [brief({ id: 'req1', planId: 'p1' })],
    }).resolveAll(USER);

    expect(events).toHaveLength(2);
    expect(events.filter((e) => e.source === 'plan')).toHaveLength(1);
    expect(events.filter((e) => e.source === 'quote')).toHaveLength(1);
  });

  it('keeps a newer open brief when an older one has been booked', async () => {
    // Per brief, not once for the account: an older accepted brief can have a
    // finished booking while a newer one is still collecting quotes.
    const events = await serviceWith({
      activeBriefs: [
        brief({ id: 'req-new', occasion: 'Wedding' }),
        brief({ id: 'req-old', occasion: 'Corporate' }),
      ],
      liveBookings: [booking({ id: 'bk1', requestId: 'req-old' })],
    }).resolveAll(USER);

    expect(events.map((e) => e.source)).toEqual(['booking', 'quote']);
    expect(events.find((e) => e.source === 'quote')?.refId).toBe('req-new');
  });

  it('lists every record of every kind for a busy account', async () => {
    const events = await serviceWith({
      activePlans: [plan({ _id: 'p1' })],
      activeBriefs: [brief({ id: 'req1' }), brief({ id: 'req2' })],
      liveBookings: [booking({ id: 'bk1' }), booking({ id: 'bk2' })],
    }).resolveAll(USER);

    expect(events).toHaveLength(5);
    // Furthest along first, and stable within a stage.
    expect(events.map((e) => e.source)).toEqual(['booking', 'booking', 'quote', 'quote', 'plan']);
  });
});

describe('not showing one event twice', () => {
  it('drops the brief a booking was made from', async () => {
    const events = await serviceWith({
      latestBooking: booking({ requestId: 'req1' }),
      latestBrief: brief({ id: 'req1', status: QuoteRequestStatus.ACCEPTED }),
      bookedFromRequest: true,
    }).resolveAll(USER);

    expect(events).toHaveLength(1);
    expect(events[0].source).toBe('booking');
  });

  it('keeps a brief for a different event than the booking', async () => {
    // Same customer, two requests: only the one behind the booking is covered.
    const events = await serviceWith({
      latestBooking: booking({ requestId: 'req-other' }),
      latestBrief: brief({ id: 'req1' }),
    }).resolveAll(USER);

    expect(events).toHaveLength(2);
  });

  it('drops the plan a live brief was built from', async () => {
    /*
     * Nothing in the codebase ever moves a plan to QUOTED, so the plan behind
     * a brief stays SUBMITTED for good. Without this the wizard would put the
     * customer's one event on screen twice, at two different stages.
     */
    const events = await serviceWith({
      latestPlan: plan(),
      latestBrief: brief({ planId: PLAN_ID.toString() }),
    }).resolveAll(USER);

    expect(events).toHaveLength(1);
    expect(events[0].source).toBe('quote');
  });

  it('keeps a plan for a different event than the brief', async () => {
    const events = await serviceWith({
      latestPlan: plan(),
      latestBrief: brief({ planId: new Types.ObjectId().toString() }),
    }).resolveAll(USER);

    expect(events).toHaveLength(2);
  });

  it('keeps a plan when the brief came from no plan at all', async () => {
    // The Home hero's quick "Get quotes" draft creates no plan document.
    const events = await serviceWith({
      latestPlan: plan(),
      latestBrief: brief({ planId: null }),
    }).resolveAll(USER);

    expect(events).toHaveLength(2);
  });

  it('does not resurface an accepted brief whose booking has finished', async () => {
    // The booking completed, so it is not returned as live; the lingering
    // ACCEPTED request must not bring the event back as if it were open.
    const events = await serviceWith({
      latestBrief: brief({ status: QuoteRequestStatus.ACCEPTED }),
      bookedFromRequest: true,
    }).resolveAll(USER);

    expect(events).toEqual([]);
  });
});
