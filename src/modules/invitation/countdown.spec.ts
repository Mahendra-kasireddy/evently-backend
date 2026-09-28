/**
 * When the event is, and what the guest is told about it.
 *
 * The two things worth pinning down both fail silently. A wall-clock time
 * resolved in the wrong zone gives every guest a different countdown and
 * nobody an error; and the notice's state machine has one arm — the guest who
 * never opened the invitation during the final day — that only runs once, in
 * production, on somebody's wedding.
 */

import { Types } from 'mongoose';
import { countdownTargetOf, notificationFor, zonedInstant } from './countdown';
import { NotificationKind, ONE_DAY_MS } from './invitation-defaults';
import type { InvitationDocument } from './schemas/invitation.schema';
import type { InvitationGuestDocument } from './schemas/invitation-guest.schema';

const CEREMONY = new Types.ObjectId();

/** Only the fields these functions read; the rest of the document is noise. */
const invitation = (
  details: Record<string, unknown> = {},
  subEvents: Array<Record<string, unknown>> = [],
) =>
  ({
    details: {
      eventDate: '2026-10-10',
      eventTime: '18:00',
      timezone: 'Asia/Kolkata',
      venueName: 'Taj Krishna',
      venueAddress: 'Banjara Hills, Hyderabad',
      countdownSubEventId: '',
      oneDayNotificationEnabled: true,
      oneDayNotificationMessage: 'We are almost there.',
      missedNotificationMessage: 'We hope you had a wonderful time.',
      postEventMessage: '',
      ...details,
    },
    subEvents,
  }) as unknown as InvitationDocument;

const guest = (notifications: Array<Record<string, unknown>> = []) =>
  ({ notifications }) as unknown as InvitationGuestDocument;

/** 10 Oct 2026, 18:00 in Kolkata — the instant every guest counts down to. */
const EVENT_MS = Date.UTC(2026, 9, 10, 12, 30);

describe('the event moment', () => {
  it('resolves a wall-clock time against the event’s own zone', () => {
    // 18:00 IST is 12:30 UTC. Six in the evening in Hyderabad is not six in
    // the evening in London, and the stored string says nothing about which.
    expect(zonedInstant('2026-10-10', '18:00', 'Asia/Kolkata')).toBe(EVENT_MS);
  });

  it('gives the same instant whatever the reader’s own zone is', () => {
    /*
     * The whole point: this runs on a server in one zone and on phones in
     * others, and all of them must name the same moment.
     */
    const asKolkata = zonedInstant('2026-10-10', '18:00', 'Asia/Kolkata');
    const asNewYork = zonedInstant('2026-10-10', '08:30', 'America/New_York');
    expect(asKolkata).toBe(asNewYork);
  });

  it('settles the offset across a daylight-saving boundary', () => {
    // London is BST (+1) in July and GMT (+0) in December.
    expect(zonedInstant('2026-07-01', '12:00', 'Europe/London')).toBe(Date.UTC(2026, 6, 1, 11, 0));
    expect(zonedInstant('2026-12-01', '12:00', 'Europe/London')).toBe(Date.UTC(2026, 11, 1, 12, 0));
  });

  it('is null rather than a guess when there is no date', () => {
    expect(zonedInstant('', '18:00', 'Asia/Kolkata')).toBeNull();
  });

  it('falls back to UTC for a zone the runtime does not know', () => {
    // Not a silent reinterpretation per browser, which is the failure this
    // avoids — one defined answer everywhere.
    expect(zonedInstant('2026-10-10', '18:00', 'Mars/Olympus')).toBe(Date.UTC(2026, 9, 10, 18, 0));
  });
});

describe('what the countdown points at', () => {
  const ceremony = {
    _id: CEREMONY,
    name: 'Wedding Ceremony',
    eventDate: '2026-10-11',
    eventTime: '09:00',
    timezone: 'Asia/Kolkata',
    venueName: 'The Great Hall',
    venueAddress: 'Jubilee Hills',
  };

  it('uses the sub-event the organizer chose, not the invitation’s date', () => {
    const target = countdownTargetOf(
      invitation({ countdownSubEventId: CEREMONY.toString() }, [ceremony]),
    );
    expect(target?.name).toBe('Wedding Ceremony');
    expect(target?.startsAt).toBe(new Date(Date.UTC(2026, 9, 11, 3, 30)).toISOString());
    expect(target?.venueName).toBe('The Great Hall');
  });

  it('falls back when the chosen sub-event has since been deleted', () => {
    /*
     * The organizer picked a ceremony and later removed the card. A countdown
     * to a missing record would render as a block counting down to nothing.
     */
    const target = countdownTargetOf(invitation({ countdownSubEventId: CEREMONY.toString() }, []));
    expect(target?.subEventId).toBe('');
    expect(target?.startsAt).toBe(new Date(EVENT_MS).toISOString());
  });

  it('is nothing at all when no date has been set anywhere', () => {
    expect(countdownTargetOf(invitation({ eventDate: '' }))).toBeNull();
  });
});

describe('the day-before notice', () => {
  const decide = (nowMs: number, inv = invitation(), g = guest()) =>
    notificationFor(inv, g, countdownTargetOf(inv), nowMs);

  it('says nothing three days out', () => {
    expect(decide(EVENT_MS - 3 * ONE_DAY_MS)).toEqual({ show: false });
  });

  it('is raised once the event is within a day', () => {
    const shown = decide(EVENT_MS - 20 * 60 * 60 * 1000);
    expect(shown).toMatchObject({ show: true, state: 'upcoming' });
  });

  it('is raised at the very edge of the window, not just inside it', () => {
    expect(decide(EVENT_MS - ONE_DAY_MS)).toMatchObject({ show: true, state: 'upcoming' });
  });

  it('changes to the past tense for a guest who only opens it afterwards', () => {
    /*
     * The arm that matters: they never opened the invitation during the final
     * day, so they were never told. Telling them now in the future tense
     * would be telling them something untrue.
     */
    const shown = decide(EVENT_MS + 2 * 60 * 60 * 1000);
    expect(shown).toMatchObject({
      show: true,
      state: 'missed',
      message: 'We hope you had a wonderful time.',
    });
  });

  it('stays dismissed once the guest has dismissed it', () => {
    const dismissed = guest([
      { kind: NotificationKind.ONE_DAY, target: '', dismissedAt: new Date() },
    ]);
    expect(decide(EVENT_MS - 60 * 60 * 1000, invitation(), dismissed)).toEqual({ show: false });
    // Including afterwards: a dismissal is not undone by the event happening.
    expect(decide(EVENT_MS + 60 * 60 * 1000, invitation(), dismissed)).toEqual({ show: false });
  });

  it('is raised again when the organizer repoints the countdown elsewhere', () => {
    /*
     * A dismissal answers one event. Moved to a different ceremony, the guest
     * has not been told about that one.
     */
    const moved = invitation({ countdownSubEventId: CEREMONY.toString() }, [
      {
        _id: CEREMONY,
        name: 'Reception',
        eventDate: '2026-10-10',
        eventTime: '18:00',
        timezone: 'Asia/Kolkata',
        venueName: '',
        venueAddress: '',
      },
    ]);
    const dismissedTheOther = guest([
      { kind: NotificationKind.ONE_DAY, target: '', dismissedAt: new Date() },
    ]);
    expect(decide(EVENT_MS - 60 * 60 * 1000, moved, dismissedTheOther)).toMatchObject({
      show: true,
    });
  });

  it('says nothing at all when the organizer turned it off', () => {
    const off = invitation({ oneDayNotificationEnabled: false });
    expect(decide(EVENT_MS - 60 * 60 * 1000, off)).toEqual({ show: false });
  });

  it('says nothing when there is no event to be about', () => {
    expect(decide(EVENT_MS, invitation({ eventDate: '' }))).toEqual({ show: false });
  });
});
