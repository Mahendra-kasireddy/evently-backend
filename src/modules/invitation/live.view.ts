import { Types } from 'mongoose';
import { InvitationDocument, InvitationSubEvent } from './schemas/invitation.schema';
import { GuestGroup, InvitationGuestDocument } from './schemas/invitation-guest.schema';
import { guestSubEventsFor } from './save-the-date.view';
import { DEFAULT_LIVE_MESSAGE, DEFAULT_LIVE_TITLE, NotificationKind } from './invitation-defaults';

/**
 * The live stream, as a guest reads it.
 *
 * Its own file, like `story.view.ts` and `save-the-date.view.ts` before it:
 * both the organizer's service and the guest's service need these answers, and
 * having either import the other is how the schema/defaults cycle happened.
 */

/** One way of watching, named for the control the guest taps. */
export interface LiveStreamMode {
  id: 'standard' | '360' | 'vr';
  url: string;
}

export interface LiveStreamView {
  subEventId: string;
  /** The event's own name — "The Wedding Ceremony". */
  name: string;
  /** The organizer's line for the section, or a sensible default. */
  title: string;
  /** Always at least one entry; `modes[0]` is what plays first. */
  modes: LiveStreamMode[];
  /** ISO instant the organizer switched it on. */
  startedAt: string;
  venueName: string;
  venueAddress: string;
  eventDate: string;
  eventTime: string;
  timezone: string;
  dressCode: string;
}

/**
 * The event whose stream is on, for this guest.
 *
 * Visibility is not re-decided here: the candidates are whatever
 * `guestSubEventsFor` already allows, so a stream attached to a card this
 * guest may not see cannot be reached by adding a query parameter. One rule,
 * one place — a second copy is a second thing to get wrong.
 *
 * At most one is returned. Two ceremonies streaming at once is not a case the
 * invitation has a design for, and the first in the organizer's own order is
 * the one they put first.
 */
export function liveSubEventFor(
  subEvents: InvitationSubEvent[],
  group: GuestGroup | undefined,
): InvitationSubEvent | null {
  const on = guestSubEventsFor(subEvents, group).filter(
    (e) => e.liveEnabled && (e.liveUrl ?? '').trim() !== '',
  );
  return on[0] ?? null;
}

/** The modes an organizer has actually supplied a url for. */
function modesOf(event: InvitationSubEvent): LiveStreamMode[] {
  const modes: LiveStreamMode[] = [{ id: 'standard', url: event.liveUrl }];
  /*
   * Only offered when there is something behind them. A 360° control that
   * plays the flat stream is a promise the invitation cannot keep, and a guest
   * who taps it learns the app is lying rather than that the feed is flat.
   */
  if ((event.live360Url ?? '').trim()) modes.push({ id: '360', url: event.live360Url });
  if ((event.liveVrUrl ?? '').trim()) modes.push({ id: 'vr', url: event.liveVrUrl });
  return modes;
}

/** The whole live block for one guest, or null when nothing is streaming. */
export function liveViewFor(
  invitation: InvitationDocument,
  group: GuestGroup | undefined,
): LiveStreamView | null {
  const event = liveSubEventFor(invitation.subEvents, group);
  if (!event) return null;
  return {
    subEventId: (event as { _id?: Types.ObjectId })._id?.toString() ?? '',
    name: event.name,
    title: (event.liveTitle ?? '').trim() || DEFAULT_LIVE_TITLE,
    modes: modesOf(event),
    startedAt: (event.liveStartedAt ?? new Date()).toISOString(),
    venueName: event.venueName,
    venueAddress: event.venueAddress,
    eventDate: event.eventDate,
    eventTime: event.eventTime,
    timezone: event.timezone,
    dressCode: event.dressCode,
  };
}

/** The same shape `notificationFor` answers with, so the client reads one field. */
export interface LiveNotificationView {
  show: boolean;
  kind?: NotificationKind;
  state?: 'live';
  message?: string;
  /** Which event it is about, so the client can scroll to it. */
  subEventId?: string;
  name?: string;
}

/**
 * Whether to raise the "it's started" card with this guest.
 *
 * Keyed by the sub-event, exactly as the day-before notice is: a guest who
 * dismissed the mehendi's stream has not been told about the ceremony's, and
 * an organizer who switches a stream off and on again is starting the same
 * one — dismissed stays dismissed, because the alternative is a pop-up that
 * returns every time a stream drops and reconnects.
 */
export function liveNotificationFor(
  guest: InvitationGuestDocument,
  live: LiveStreamView | null,
): LiveNotificationView {
  if (!live) return { show: false };
  const dismissed = (guest.notifications ?? []).some(
    (n) => n.kind === NotificationKind.LIVE_STARTED && (n.target ?? '') === live.subEventId,
  );
  if (dismissed) return { show: false };
  return {
    show: true,
    kind: NotificationKind.LIVE_STARTED,
    state: 'live',
    message: DEFAULT_LIVE_MESSAGE,
    subEventId: live.subEventId,
    name: live.name,
  };
}
