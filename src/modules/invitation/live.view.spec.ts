/**
 * Who may watch which stream, and who gets told it started.
 *
 * This is F5's access rule and its one-shot rule. Both fail quietly: a stream
 * reaching a guest who was not invited to that ceremony looks like nothing at
 * all from the outside, and a pop-up that forgets it was dismissed looks like
 * a working feature until it reappears on every reconnect.
 */

import { liveNotificationFor, liveSubEventFor, liveViewFor } from './live.view';
import { SubEventVisibility } from './schemas/invitation.schema';
import { GuestGroup, InvitationGuestDocument } from './schemas/invitation-guest.schema';
import { NotificationKind, isEmbeddableStreamUrl } from './invitation-defaults';
import type { InvitationDocument, InvitationSubEvent } from './schemas/invitation.schema';

const STREAM = 'https://www.youtube.com/embed/abc123';

const card = (over: Partial<InvitationSubEvent> = {}): InvitationSubEvent =>
  ({
    name: 'The Wedding Ceremony',
    eventDate: '2026-10-10',
    eventTime: '18:00',
    endTime: '',
    timezone: 'Asia/Kolkata',
    venueName: 'Taj Krishna',
    venueAddress: 'Banjara Hills, Hyderabad',
    dressCode: 'Traditional / Formal',
    note: '',
    colour: '',
    visibility: SubEventVisibility.ALL_GUESTS,
    groups: [],
    liveEnabled: true,
    liveTitle: '',
    liveUrl: STREAM,
    live360Url: '',
    liveVrUrl: '',
    liveStartedAt: new Date('2026-10-10T12:30:00Z'),
    ...over,
  }) as InvitationSubEvent;

const guest = (over: Partial<InvitationGuestDocument> = {}) =>
  ({ notifications: [], ...over }) as unknown as InvitationGuestDocument;

const invitationOf = (subEvents: InvitationSubEvent[]) =>
  ({ subEvents }) as unknown as InvitationDocument;

describe('which stream a guest may watch', () => {
  it('offers a stream on an event everyone is invited to', () => {
    expect(liveSubEventFor([card()], GuestGroup.WORK)?.name).toBe('The Wedding Ceremony');
  });

  it('offers nothing while the organizer has the switch off', () => {
    expect(liveSubEventFor([card({ liveEnabled: false })], GuestGroup.FAMILY)).toBeNull();
  });

  it('offers nothing when the switch is on but no url was given', () => {
    // Half-configured is not live. A LIVE badge over an empty player is worse
    // than no badge at all.
    expect(liveSubEventFor([card({ liveUrl: '' })], GuestGroup.FAMILY)).toBeNull();
  });

  it('never reaches a guest outside the event the stream belongs to', () => {
    const familyOnly = [
      card({ visibility: SubEventVisibility.GROUPS, groups: [GuestGroup.FAMILY] }),
    ];
    expect(liveSubEventFor(familyOnly, GuestGroup.FAMILY)?.name).toBe('The Wedding Ceremony');
    expect(liveSubEventFor(familyOnly, GuestGroup.WORK)).toBeNull();
    expect(liveSubEventFor(familyOnly, undefined)).toBeNull();
  });

  it('never reaches anyone when the event itself is hidden', () => {
    const hidden = [card({ visibility: SubEventVisibility.HIDDEN })];
    expect(liveSubEventFor(hidden, GuestGroup.FAMILY)).toBeNull();
  });

  it('takes the first one when two are somehow on at once', () => {
    const two = [card({ name: 'Mehendi' }), card({ name: 'Ceremony' })];
    expect(liveSubEventFor(two, undefined)?.name).toBe('Mehendi');
  });
});

describe('the live block a guest is handed', () => {
  it('offers only the modes an organizer supplied a url for', () => {
    const view = liveViewFor(invitationOf([card()]), undefined);
    expect(view?.modes.map((m) => m.id)).toEqual(['standard']);

    const withAll = liveViewFor(
      invitationOf([card({ live360Url: STREAM, liveVrUrl: STREAM })]),
      undefined,
    );
    expect(withAll?.modes.map((m) => m.id)).toEqual(['standard', '360', 'vr']);
  });

  it('falls back to a title rather than showing an empty heading', () => {
    expect(liveViewFor(invitationOf([card()]), undefined)?.title).toBe('Watch the ceremony live');
    expect(
      liveViewFor(invitationOf([card({ liveTitle: 'Watch the Ceremony Live' })]), undefined)?.title,
    ).toBe('Watch the Ceremony Live');
  });

  it('carries the event details the section shows under the player', () => {
    const view = liveViewFor(invitationOf([card()]), undefined);
    expect(view).toMatchObject({
      name: 'The Wedding Ceremony',
      venueName: 'Taj Krishna',
      dressCode: 'Traditional / Formal',
      eventDate: '2026-10-10',
      eventTime: '18:00',
    });
  });

  it('is null when nothing is streaming', () => {
    expect(liveViewFor(invitationOf([card({ liveEnabled: false })]), undefined)).toBeNull();
  });
});

describe('the "it has started" card', () => {
  const live = () => liveViewFor(invitationOf([card()]), undefined);

  it('is raised once, for the event that is on', () => {
    const notice = liveNotificationFor(guest(), live());
    expect(notice.show).toBe(true);
    expect(notice.kind).toBe(NotificationKind.LIVE_STARTED);
    expect(notice.name).toBe('The Wedding Ceremony');
  });

  it('stays dismissed, including across a stream dropping and returning', () => {
    const view = live();
    const dismissed = guest({
      notifications: [
        {
          kind: NotificationKind.LIVE_STARTED,
          target: view!.subEventId,
          dismissedAt: new Date(),
        },
      ],
    } as unknown as Partial<InvitationGuestDocument>);
    expect(liveNotificationFor(dismissed, view).show).toBe(false);
  });

  it('is not silenced by having dismissed the day-before notice', () => {
    // Different notices about the same event. Dismissing one says nothing
    // about the other.
    const dismissedOneDay = guest({
      notifications: [{ kind: NotificationKind.ONE_DAY, target: '', dismissedAt: new Date() }],
    } as unknown as Partial<InvitationGuestDocument>);
    expect(liveNotificationFor(dismissedOneDay, live()).show).toBe(true);
  });

  it('is not raised when nothing is live', () => {
    expect(liveNotificationFor(guest(), null).show).toBe(false);
  });
});

describe('which urls may be embedded', () => {
  it('accepts https players we host streams from', () => {
    expect(isEmbeddableStreamUrl(STREAM)).toBe(true);
    expect(isEmbeddableStreamUrl('https://player.vimeo.com/video/76979871')).toBe(true);
  });

  it('refuses anything that is not https', () => {
    expect(isEmbeddableStreamUrl('http://www.youtube.com/embed/abc')).toBe(false);
  });

  it('refuses a script url dressed as a stream', () => {
    // This value would become an iframe `src` in a guest's browser.
    expect(isEmbeddableStreamUrl('javascript:alert(1)')).toBe(false);
    expect(isEmbeddableStreamUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
  });

  it('refuses a host that is not on the list', () => {
    expect(isEmbeddableStreamUrl('https://evil.example.com/embed/abc')).toBe(false);
    // Not fooled by the allowed host appearing somewhere in the string.
    expect(isEmbeddableStreamUrl('https://www.youtube.com.evil.example/embed')).toBe(false);
  });

  it('refuses empty, so a blank url can never be "live"', () => {
    expect(isEmbeddableStreamUrl('')).toBe(false);
  });
});
