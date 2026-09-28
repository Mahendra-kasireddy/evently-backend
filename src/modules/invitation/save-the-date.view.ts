import { Types } from 'mongoose';
import {
  InvitationDocument,
  InvitationSubEvent,
  SubEventVisibility,
} from './schemas/invitation.schema';
import { GuestGroup, InvitationGuestDocument } from './schemas/invitation-guest.schema';

/**
 * Which Save-the-Date cards a particular guest may see.
 *
 * Decided here and nowhere else. The organizer's builder shows every card, the
 * guest's invitation shows theirs, and the difference between the two is a
 * filter that runs on the server — a card the guest is not invited to is not
 * hidden in their browser, it never reaches it.
 *
 * Three rules, in the order they are read: a hidden card is builder-only state
 * and reaches nobody; a targeted card reaches the groups it names; everything
 * else reaches everyone. A card with no name is not a card yet.
 */
export function guestSubEventsFor(
  subEvents: InvitationSubEvent[],
  group: GuestGroup | undefined,
): InvitationSubEvent[] {
  return subEvents.filter((event) => {
    if (!event.name || !event.name.trim()) return false;
    if (event.visibility === SubEventVisibility.HIDDEN) return false;
    if (event.visibility === SubEventVisibility.GROUPS) {
      /*
       * A targeted card with no groups named reaches nobody. That is the safe
       * reading of a half-finished setting: the organizer said "only some
       * people" and has not yet said who, so nobody is the answer until they
       * do — the alternative silently sends it to everyone.
       */
      const groups = event.groups ?? [];
      return group !== undefined && groups.includes(group);
    }
    return true;
  });
}

/** One card, as a guest reads it. Never carries the targeting rule itself. */
export function saveTheDateView(
  invitation: InvitationDocument,
  group: GuestGroup | undefined,
): Array<Record<string, unknown>> {
  return guestSubEventsFor(invitation.subEvents, group).map((e) => ({
    id: (e as { _id?: Types.ObjectId })._id?.toString() ?? '',
    name: e.name,
    eventDate: e.eventDate,
    eventTime: e.eventTime,
    endTime: e.endTime,
    timezone: e.timezone,
    venueName: e.venueName,
    venueAddress: e.venueAddress,
    dressCode: e.dressCode,
    note: e.note,
    colour: e.colour,
    /*
     * Deliberately absent: `visibility` and `groups`. Who else was invited to
     * the mehendi is the organizer's business, and a guest who can read the
     * targeting can work out which list they are on.
     */
  }));
}

/** The group this guest is filed under, or undefined when they have none. */
export function groupOf(guest: InvitationGuestDocument): GuestGroup | undefined {
  return guest.group ?? undefined;
}
