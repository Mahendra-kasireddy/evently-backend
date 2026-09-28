/**
 * Which Save-the-Date cards reach which guest.
 *
 * This is the access rule for F4, so it is worth stating exactly. The failure
 * it guards against is quiet in both directions: a card that reaches a guest
 * who was never invited to that ceremony, and a targeted card that reaches
 * everybody because the targeting was half-finished.
 */

import { guestSubEventsFor, saveTheDateView } from './save-the-date.view';
import { SubEventVisibility } from './schemas/invitation.schema';
import { GuestGroup } from './schemas/invitation-guest.schema';
import type { InvitationDocument, InvitationSubEvent } from './schemas/invitation.schema';

const card = (over: Partial<InvitationSubEvent> = {}): InvitationSubEvent =>
  ({
    name: 'Mehendi',
    eventDate: '2026-10-09',
    eventTime: '10:00',
    endTime: '',
    timezone: 'Asia/Kolkata',
    venueName: 'Taj Krishna',
    venueAddress: 'Banjara Hills',
    dressCode: 'Yellow & Floral',
    note: 'Let the celebrations begin!',
    colour: '',
    visibility: SubEventVisibility.ALL_GUESTS,
    groups: [],
    ...over,
  }) as InvitationSubEvent;

const names = (cards: InvitationSubEvent[], group?: GuestGroup) =>
  guestSubEventsFor(cards, group).map((c) => c.name);

describe('which cards a guest may see', () => {
  it('shows a card meant for everyone to everyone', () => {
    expect(names([card()], GuestGroup.WORK)).toEqual(['Mehendi']);
    expect(names([card()], undefined)).toEqual(['Mehendi']);
  });

  it('never shows a hidden card, whoever is asking', () => {
    // Builder-only state, not guest content.
    const hidden = [card({ name: 'Draft', visibility: SubEventVisibility.HIDDEN })];
    expect(names(hidden, GuestGroup.FAMILY)).toEqual([]);
  });

  it('shows a targeted card only to the groups it names', () => {
    const family = [
      card({
        name: 'Haldi',
        visibility: SubEventVisibility.GROUPS,
        groups: [GuestGroup.FAMILY],
      }),
    ];
    expect(names(family, GuestGroup.FAMILY)).toEqual(['Haldi']);
    expect(names(family, GuestGroup.FRIENDS)).toEqual([]);
    expect(names(family, GuestGroup.WORK)).toEqual([]);
  });

  it('shows a card targeted at several groups to each of them', () => {
    const both = [
      card({
        name: 'Sangeet',
        visibility: SubEventVisibility.GROUPS,
        groups: [GuestGroup.FAMILY, GuestGroup.FRIENDS],
      }),
    ];
    expect(names(both, GuestGroup.FAMILY)).toEqual(['Sangeet']);
    expect(names(both, GuestGroup.FRIENDS)).toEqual(['Sangeet']);
    expect(names(both, GuestGroup.WORK)).toEqual([]);
  });

  it('shows a targeted card with no groups named to nobody', () => {
    /*
     * The safe reading of a half-finished setting: the organizer said "only
     * some people" and has not yet said who. Showing it to everyone would be
     * the opposite of what they asked for, and silent.
     */
    const unfinished = [card({ visibility: SubEventVisibility.GROUPS, groups: [] })];
    expect(names(unfinished, GuestGroup.FAMILY)).toEqual([]);
    expect(names(unfinished, undefined)).toEqual([]);
  });

  it('shows a targeted card to nobody when the guest has no group', () => {
    const targeted = [card({ visibility: SubEventVisibility.GROUPS, groups: [GuestGroup.FAMILY] })];
    expect(names(targeted, undefined)).toEqual([]);
  });

  it('does not treat an unnamed card as a card', () => {
    expect(names([card({ name: '   ' })], GuestGroup.FAMILY)).toEqual([]);
  });
});

describe('what a card tells the guest', () => {
  const view = (cards: InvitationSubEvent[], group?: GuestGroup) =>
    saveTheDateView({ subEvents: cards } as unknown as InvitationDocument, group);

  it('carries everything the card and its calendar entry need', () => {
    const [only] = view([card()]);
    expect(only).toMatchObject({
      name: 'Mehendi',
      eventDate: '2026-10-09',
      eventTime: '10:00',
      timezone: 'Asia/Kolkata',
      venueName: 'Taj Krishna',
      venueAddress: 'Banjara Hills',
      dressCode: 'Yellow & Floral',
      note: 'Let the celebrations begin!',
    });
  });

  it('never tells a guest who else the card was aimed at', () => {
    /*
     * Who else was invited to the mehendi is the organizer's business, and a
     * guest who can read the targeting can work out which list they are on.
     */
    const [only] = view(
      [card({ visibility: SubEventVisibility.GROUPS, groups: [GuestGroup.FAMILY] })],
      GuestGroup.FAMILY,
    );
    expect(only).not.toHaveProperty('groups');
    expect(only).not.toHaveProperty('visibility');
  });
});
