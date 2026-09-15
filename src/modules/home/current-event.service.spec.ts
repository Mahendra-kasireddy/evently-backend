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
  bookedFromRequest = false,
  unread = 0,
}: {
  latestPlan?: unknown;
  latestBrief?: unknown;
  latestBooking?: unknown;
  bookedFromRequest?: boolean;
  unread?: number;
} = {}) {
  return new CurrentEventService(
    { getLatestActiveForUser: jest.fn().mockResolvedValue(latestPlan) } as never,
    { getLatestActiveForUser: jest.fn().mockResolvedValue(latestBrief) } as never,
    {
      getLatestForUser: jest.fn().mockResolvedValue(latestBooking),
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
