/**
 * How an upload is sorted.
 *
 * The spec calls this the AI, so it is worth being exact about what it is: a
 * tag, a clock and two comparisons. Both failures it guards against are quiet
 * — a photograph filed under the wrong ceremony, and a clip that lands in the
 * wrong tab — and neither shows up as an error anywhere.
 */

import { kindOf, clipRefusal, subEventForUpload } from './separation';
import { MediaKind } from './memory.constants';
import type { InvitationSubEvent } from '../schemas/invitation.schema';

const at = (date: string, time: string) => Date.parse(`${date}T${time}:00+05:30`);

const event = (
  id: string,
  eventDate: string,
  eventTime: string,
  endTime = '',
): InvitationSubEvent =>
  ({
    _id: { toString: () => id },
    name: id,
    eventDate,
    eventTime,
    endTime,
    timezone: 'Asia/Kolkata',
  }) as unknown as InvitationSubEvent;

const HALDI = event('haldi', '2026-10-08', '10:00', '13:00');
const SANGEET = event('sangeet', '2026-10-09', '19:00', '23:00');
const WEDDING = event('wedding', '2026-10-10', '18:00', '21:00');
const ALL = [HALDI, SANGEET, WEDDING];

describe('what kind of thing was uploaded', () => {
  it('calls a still image a photo, whatever else is said about it', () => {
    expect(kindOf({ isClip: false })).toBe(MediaKind.PHOTO);
    expect(kindOf({ isClip: false, reel: true, durationSec: 30 })).toBe(MediaKind.PHOTO);
  });

  it('lets the tag decide between the two clip kinds', () => {
    expect(kindOf({ isClip: true, durationSec: 30, reel: true })).toBe(MediaKind.REEL);
    expect(kindOf({ isClip: true, durationSec: 30 })).toBe(MediaKind.VIDEO);
  });

  it('files a short untagged clip as a video rather than nothing', () => {
    // The spec's "videos are over 15 seconds" would have left this homeless.
    expect(kindOf({ isClip: true, durationSec: 8 })).toBe(MediaKind.VIDEO);
  });

  it('files an over-long reel as a video rather than refusing it', () => {
    // Nothing the guest did was wrong, and the gallery has somewhere to put it.
    expect(kindOf({ isClip: true, durationSec: 90, reel: true })).toBe(MediaKind.VIDEO);
  });

  it('refuses only a clip beyond the hard ceiling', () => {
    expect(clipRefusal({ isClip: true, durationSec: 300 })).toBe('');
    expect(clipRefusal({ isClip: true, durationSec: 3600 })).toContain('at most');
    expect(clipRefusal({ isClip: false })).toBe('');
  });
});

describe('which celebration an upload belongs to', () => {
  it('honours the guest’s own tag', () => {
    // Even when the clock disagrees: they were there, we were not.
    expect(subEventForUpload(ALL, 'haldi', at('2026-10-10', '19:00'))).toBe('haldi');
  });

  it('ignores a tag naming something that is not on this invitation', () => {
    // It arrived from a client, so it is a claim and not a fact.
    expect(subEventForUpload(ALL, 'someone-elses-event', at('2026-10-09', '20:00'))).toBe('');
  });

  it('uses the celebration that was happening at the time', () => {
    expect(subEventForUpload(ALL, '', at('2026-10-09', '20:30'))).toBe('sangeet');
    expect(subEventForUpload(ALL, '', at('2026-10-08', '11:00'))).toBe('haldi');
  });

  it('takes the nearest one when nothing was happening', () => {
    // Ten minutes after the haldi ended is still the haldi.
    expect(subEventForUpload(ALL, '', at('2026-10-08', '13:10'))).toBe('haldi');
    // The morning of the wedding is nearer the wedding than last night.
    expect(subEventForUpload(ALL, '', at('2026-10-10', '16:00'))).toBe('wedding');
  });

  it('measures the gap to the window, not to its start', () => {
    /*
     * An hour after the sangeet ended vs. nineteen hours before the wedding
     * starts. Measuring from each start would have picked the wedding.
     */
    expect(subEventForUpload(ALL, '', at('2026-10-10', '00:00'))).toBe('sangeet');
  });

  it('answers empty when there is nothing dated to sort into', () => {
    expect(subEventForUpload([], '', Date.now())).toBe('');
    expect(subEventForUpload([event('x', '', '')], '', Date.now())).toBe('');
  });

  it('still honours a tag pointing at a sub-event with no date', () => {
    const undated = [event('mehendi', '', ''), SANGEET];
    expect(subEventForUpload(undated, 'mehendi', at('2026-10-09', '20:00'))).toBe('mehendi');
  });
});
