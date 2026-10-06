import { liveStreamFilter, notEndedBy } from './customer-public-event.service';

/**
 * The catalogue only offers events that are still on or still to come. This
 * pins the query shape, so a refactor cannot quietly start listing last
 * month's events again.
 */
describe('catalogue: not-ended filter', () => {
  const now = new Date('2026-10-06T12:00:00Z');

  it('keeps events whose end is still ahead, including ones in progress', () => {
    expect(notEndedBy(now)).toEqual({
      $or: [
        { endDateTime: { $gt: now } },
        { endDateTime: null, startDateTime: { $gt: now } },
      ],
    });
  });

  it('judges an event with no end by its start', () => {
    const [, noEnd] = notEndedBy(now).$or as Array<Record<string, unknown>>;
    expect(noEnd).toEqual({ endDateTime: null, startDateTime: { $gt: now } });
  });
});


describe('catalogue: live stream filter', () => {
  const now = new Date('2026-10-06T12:00:00Z');

  it('finds streams on right now, including ones with no end set', () => {
    expect(liveStreamFilter('now', now)).toEqual({
      'liveStream.enabled': true,
      'liveStream.startsAt': { $lte: now },
      $or: [{ 'liveStream.endsAt': { $gt: now } }, { 'liveStream.endsAt': null }],
    });
  });

  it('finds streams scheduled and not yet begun', () => {
    expect(liveStreamFilter('upcoming', now)).toEqual({
      'liveStream.enabled': true,
      'liveStream.startsAt': { $gt: now },
    });
  });
});
