import { Types } from 'mongoose';
import { InvitationSubEvent } from '../schemas/invitation.schema';
import { DEFAULT_SUB_EVENT_MINUTES } from '../invitation-defaults';
import { zonedInstant } from '../countdown';
import { CLIP_MAX_SECONDS, MediaKind, REEL_MAX_SECONDS } from './memory.constants';

/**
 * Sorting an upload into the gallery.
 *
 * Pure functions with no database and no storage, so the rules can be argued
 * with in a spec rather than inferred from behaviour. Both of them answer
 * questions the guest did not: which celebration this belongs to, and what
 * kind of thing it is.
 */

export interface UploadFacts {
  /** Empty for a still image. Seconds, as the client measured it. */
  durationSec?: number | undefined;
  /** Whether the guest marked this clip as a reel. */
  reel?: boolean | undefined;
  /** True when the file itself is a video rather than an image. */
  isClip: boolean;
}

/** Why an upload was refused outright, or '' when it was not. */
export function clipRefusal(facts: UploadFacts): string {
  if (!facts.isClip) return '';
  const seconds = Math.max(0, Math.round(facts.durationSec ?? 0));
  if (seconds > CLIP_MAX_SECONDS) {
    return `A clip can be at most ${CLIP_MAX_SECONDS / 60} minutes.`;
  }
  return '';
}

/**
 * Photo, video or reel.
 *
 * The tag decides between the two clip kinds, and length only says whether
 * the tag can be honoured: a guest who marked a two-minute film as a reel
 * gets a video rather than an error, because nothing they did was wrong and
 * the gallery has somewhere to put it either way.
 */
export function kindOf(facts: UploadFacts): MediaKind {
  if (!facts.isClip) return MediaKind.PHOTO;
  const seconds = Math.max(0, Math.round(facts.durationSec ?? 0));
  if (facts.reel && seconds > 0 && seconds <= REEL_MAX_SECONDS) return MediaKind.REEL;
  return MediaKind.VIDEO;
}

/** One sub-event's window on the clock, for matching an upload to it. */
interface Window {
  id: string;
  startMs: number;
  endMs: number;
}

function windowsOf(subEvents: InvitationSubEvent[]): Window[] {
  const out: Window[] = [];
  for (const event of subEvents) {
    const startMs = zonedInstant(event.eventDate, event.eventTime, event.timezone);
    if (startMs === null) continue;
    const endMs =
      zonedInstant(event.eventDate, event.endTime, event.timezone) ??
      startMs + DEFAULT_SUB_EVENT_MINUTES * 60_000;
    out.push({
      id: (event as { _id?: Types.ObjectId })._id?.toString() ?? '',
      startMs,
      /* An end before the start reads as crossing midnight — a reception
         running to 01:00 is ordinary — so it rolls a day. */
      endMs: endMs <= startMs ? endMs + 86_400_000 : endMs,
    });
  }
  return out;
}

/**
 * Which celebration a photograph belongs to.
 *
 * The guest's own tag, when they gave one and it names a real sub-event of
 * this invitation — an id that names anything else is not honoured, because
 * it arrived from a client.
 *
 * Without a tag it is decided by the clock: the celebration that was actually
 * happening when the photograph was taken, and failing that the nearest one
 * either side. A guest photographing the sangeet has their phone in their
 * hand at the sangeet, so the time is a better guess than nothing — and it is
 * a guess, which is why the organizer can move it afterwards.
 *
 * Returns '' when the invitation has no dated sub-events at all, which the
 * gallery reads as "the celebration itself".
 */
export function subEventForUpload(
  subEvents: InvitationSubEvent[],
  taggedId: string,
  uploadedAtMs: number,
): string {
  const windows = windowsOf(subEvents);

  if (taggedId) {
    const named = windows.find((w) => w.id === taggedId);
    if (named) return named.id;
    /* A tag that names a sub-event with no date still counts: it is the
       guest's own answer, and the clock is only the fallback for its absence. */
    const undated = subEvents.find(
      (e) => (e as { _id?: Types.ObjectId })._id?.toString() === taggedId,
    );
    if (undated) return taggedId;
    return '';
  }

  if (windows.length === 0) return '';

  /* Inside a window: that is the one, no arithmetic needed. */
  const during = windows.find((w) => uploadedAtMs >= w.startMs && uploadedAtMs <= w.endMs);
  if (during) return during.id;

  /* Otherwise the nearest edge, before or after. Distance to the window
     rather than to its start, so a photograph taken ten minutes after the
     haldi ended belongs to the haldi and not to tomorrow's ceremony. */
  let best = windows[0]!;
  let bestGap = Number.POSITIVE_INFINITY;
  for (const w of windows) {
    const gap = uploadedAtMs < w.startMs ? w.startMs - uploadedAtMs : uploadedAtMs - w.endMs;
    if (gap < bestGap) {
      bestGap = gap;
      best = w;
    }
  }
  return best.id;
}

/** Whether uploads are open, and what to say when they are not. */
export interface UploadWindow {
  open: boolean;
  /** Empty while open; a sentence for the guest otherwise. */
  reason: string;
  /** ISO instants, or '' when unbounded on that side. */
  opensAt: string;
  closesAt: string;
}

/**
 * When guests may add to the gallery.
 *
 * Opens when the customer said, or immediately if they did not. Closes a
 * chosen number of days after the *last* celebration, not the first — a
 * wedding's reception photographs arrive after its ceremony, and a window
 * measured from the ceremony would shut before the party.
 *
 * With nothing dated anywhere, the window is open: there is no date to
 * measure from, and refusing every upload because the invitation has no
 * calendar would be the wrong way to fail.
 */
export function uploadWindowOf(
  subEvents: InvitationSubEvent[],
  eventDate: string,
  eventTime: string,
  timezone: string,
  uploadFrom: string,
  uploadWindowDays: number,
  nowMs: number,
): UploadWindow {
  const opensMs = uploadFrom ? zonedInstant(uploadFrom, '00:00', timezone) : null;

  const ends = windowsOf(subEvents).map((w) => w.endMs);
  const own = zonedInstant(eventDate, eventTime, timezone);
  if (own !== null) ends.push(own + DEFAULT_SUB_EVENT_MINUTES * 60_000);

  const lastMs = ends.length > 0 ? Math.max(...ends) : null;
  const closesMs = lastMs === null ? null : lastMs + Math.max(0, uploadWindowDays) * 86_400_000;

  const iso = (ms: number | null) => (ms === null ? '' : new Date(ms).toISOString());

  if (opensMs !== null && nowMs < opensMs) {
    return {
      open: false,
      reason: 'Sharing photos has not opened yet.',
      opensAt: iso(opensMs),
      closesAt: iso(closesMs),
    };
  }
  if (closesMs !== null && nowMs > closesMs) {
    return {
      open: false,
      reason: 'Sharing photos has closed for this celebration.',
      opensAt: iso(opensMs),
      closesAt: iso(closesMs),
    };
  }
  return { open: true, reason: '', opensAt: iso(opensMs), closesAt: iso(closesMs) };
}
