import { Types } from 'mongoose';
import {
  DEFAULT_MISSED_MESSAGE,
  DEFAULT_ONE_DAY_MESSAGE,
  NotificationKind,
  ONE_DAY_MS,
} from './invitation-defaults';
import { InvitationDocument } from './schemas/invitation.schema';
import { InvitationGuestDocument } from './schemas/invitation-guest.schema';

/**
 * When an event actually happens, and what a guest should be told about it.
 *
 * The invitation stores wall-clock strings — `2026-10-10` and `18:00` — which
 * are right for printing "10 October, 6:00 PM" and useless on their own for
 * deciding anything, because six in the evening is a different moment in
 * Hyderabad than in London. The zone stored beside them supplies the missing
 * half, and everything here resolves the three into one UTC instant. That
 * instant is what the server compares against, and what it hands the client,
 * so a guest in New York and a guest in Chennai are answered identically.
 */

/**
 * The zone's offset from UTC, in ms, at a given instant. Positive east of
 * Greenwich. Formats the instant in the zone, reads the printed parts back as
 * though they were UTC, and takes the difference — `Intl` already carries the
 * zone database, so a date library would add weight without adding accuracy.
 */
function offsetMsAt(instantMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instantMs));

  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((p) => p.type === type);
    return found ? Number(found.value) : 0;
  };

  return (
    Date.UTC(
      read('year'),
      read('month') - 1,
      read('day'),
      read('hour'),
      read('minute'),
      read('second'),
    ) - instantMs
  );
}

/** Whether the runtime knows this zone. An unknown one falls back to UTC. */
export function isKnownZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(0);
    return true;
  } catch {
    return false;
  }
}

/**
 * The UTC instant of a wall-clock date and time in a zone, or null when either
 * is missing or malformed.
 *
 * Two passes, because a zone's offset depends on the instant being asked
 * about: the first gets close, the second settles it across a DST boundary.
 * Exact everywhere except inside a transition hour, where the wall time is
 * genuinely ambiguous and any answer is a choice.
 */
export function zonedInstant(
  eventDate: string,
  eventTime: string,
  timeZone: string,
): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) return null;
  const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(eventTime) ? eventTime : '00:00';

  const [y, m, d] = eventDate.split('-').map(Number) as [number, number, number];
  const [hh, mm] = time.split(':').map(Number) as [number, number];

  const zone = timeZone && isKnownZone(timeZone) ? timeZone : 'UTC';
  const wallAsUtc = Date.UTC(y, m - 1, d, hh, mm, 0, 0);
  if (Number.isNaN(wallAsUtc)) return null;

  let instant = wallAsUtc - offsetMsAt(wallAsUtc, zone);
  instant = wallAsUtc - offsetMsAt(instant, zone);
  return instant;
}

/** What the countdown counts down to, resolved from the invitation. */
export interface CountdownTarget {
  /** The sub-event's id, or '' when counting down to the invitation's date. */
  subEventId: string;
  name: string;
  /** The event moment as an ISO instant, or null when there is no date yet. */
  startsAt: string | null;
  startsAtMs: number | null;
  timezone: string;
  venueName: string;
  venueAddress: string;
}

/**
 * Which event the countdown is for.
 *
 * The organizer's chosen sub-event when they chose one and it still exists —
 * a sub-event deleted after being selected falls back rather than rendering a
 * countdown to nothing. Otherwise the invitation's own date, which is what an
 * invitation with no sub-events has.
 */
export function countdownTargetOf(invitation: InvitationDocument): CountdownTarget | null {
  const { details } = invitation;
  const chosenId = (details.countdownSubEventId ?? '').trim();

  const chosen = chosenId
    ? invitation.subEvents.find((e) => (e as { _id?: Types.ObjectId })._id?.toString() === chosenId)
    : undefined;

  if (chosen) {
    const timezone = chosen.timezone || details.timezone || 'UTC';
    const startsAtMs = zonedInstant(chosen.eventDate, chosen.eventTime, timezone);
    return {
      subEventId: chosenId,
      name: chosen.name,
      startsAt: startsAtMs === null ? null : new Date(startsAtMs).toISOString(),
      startsAtMs,
      timezone,
      /* The sub-event's own venue, falling back to the invitation's — a card
         that names no venue is held at the invitation's. */
      venueName: chosen.venueName || details.venueName || '',
      venueAddress: chosen.venueAddress || details.venueAddress || '',
    };
  }

  const timezone = details.timezone || 'UTC';
  const startsAtMs = zonedInstant(details.eventDate, details.eventTime, timezone);
  /* No date anywhere is not a countdown; the block renders nothing. */
  if (startsAtMs === null) return null;

  return {
    subEventId: '',
    name: '',
    startsAt: new Date(startsAtMs).toISOString(),
    startsAtMs,
    timezone,
    venueName: details.venueName ?? '',
    venueAddress: details.venueAddress ?? '',
  };
}

export type NotificationView =
  | { show: false }
  | {
      show: true;
      kind: NotificationKind;
      /** `upcoming` before the event, `missed` for a guest who arrives after. */
      state: 'upcoming' | 'missed';
      message: string;
    };

/**
 * Whether this guest should be shown the one-day notice, and which wording.
 *
 * Decided here rather than in the browser, because the answer depends on three
 * things the browser cannot be trusted with: the organizer's setting, the
 * authoritative event instant, and whether this guest has already dismissed
 * it. A client that decided for itself could be made to show a notice that was
 * dismissed, or to hide one that was not.
 *
 * The window opens 24 hours before the event and never closes: a guest who did
 * not open the invitation during that day has still not been told, so they are
 * told when they next open it — in the past tense, because by then it is.
 */
export function notificationFor(
  invitation: InvitationDocument,
  guest: InvitationGuestDocument,
  target: CountdownTarget | null,
  nowMs: number,
): NotificationView {
  const { details } = invitation;
  if (!details.oneDayNotificationEnabled) return { show: false };
  if (!target || target.startsAtMs === null) return { show: false };

  /* Dismissed once is dismissed for good — keyed by the event it was about. */
  const dismissed = (guest.notifications ?? []).some(
    (n) => n.kind === NotificationKind.ONE_DAY && (n.target ?? '') === target.subEventId,
  );
  if (dismissed) return { show: false };

  const untilMs = target.startsAtMs - nowMs;
  /* Still more than a day out: nothing to say yet. */
  if (untilMs > ONE_DAY_MS) return { show: false };

  const past = untilMs <= 0;
  return {
    show: true,
    kind: NotificationKind.ONE_DAY,
    state: past ? 'missed' : 'upcoming',
    message: past
      ? details.missedNotificationMessage || DEFAULT_MISSED_MESSAGE
      : details.oneDayNotificationMessage || DEFAULT_ONE_DAY_MESSAGE,
  };
}
