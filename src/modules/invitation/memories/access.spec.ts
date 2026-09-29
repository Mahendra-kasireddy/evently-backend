/**
 * Who may see and do what in Shared Memories.
 *
 * This is the access rule for F6, so it is worth stating exactly. Every
 * failure it guards against is silent: a guest reading a ceremony they were
 * not invited to, a photograph awaiting approval appearing before anyone
 * approved it, a download happening because a button was not hidden.
 */

import {
  canDownload,
  canOverride,
  canReadMedia,
  canUpload,
  canViewGallery,
  isInGallery,
  isPastModeration,
} from './access';
import { MediaState } from './memory.constants';
import { MediaVisibility, ModerationStatus } from '../schemas/invitation-media.schema';
import type { MediaFacts } from './access';

const GUEST = 'guest-1';
const OTHER = 'guest-2';
/** Everyone is invited to the celebration itself ('') and to the haldi. */
const ALLOWED = ['', 'haldi'];

const media = (over: Partial<MediaFacts> = {}): MediaFacts => ({
  ownerGuestId: OTHER,
  subEvent: 'haldi',
  status: MediaState.PUBLISHED,
  visibility: MediaVisibility.GALLERY,
  moderationStatus: ModerationStatus.NOT_REQUIRED,
  ...over,
});

const on = {
  enabled: true,
  guestUpload: true,
  guestView: true,
  guestDownload: true,
  moderation: false,
};

describe('the top switch', () => {
  it('turns the whole feature off for everyone', () => {
    const off = { ...on, enabled: false };
    expect(canViewGallery(off)).toBe(false);
    expect(canUpload(off, true)).toBe(false);
    expect(canDownload(off)).toBe(false);
  });

  it('treats a missing settings document as off', () => {
    // An invitation created before this feature existed has no settings, and
    // the safe reading of "nothing configured" is "nothing enabled".
    expect(canViewGallery(undefined)).toBe(false);
    expect(canUpload(undefined, true)).toBe(false);
    expect(canDownload(undefined)).toBe(false);
  });
});

describe('uploading', () => {
  it('is allowed to an invited guest while the window is open', () => {
    expect(canUpload(on, true)).toBe(true);
  });

  it('is refused once the window has closed, however the switches sit', () => {
    expect(canUpload(on, false)).toBe(false);
  });

  it('is refused when the customer turned guest uploads off', () => {
    expect(canUpload({ ...on, guestUpload: false }, true)).toBe(false);
  });
});

describe('downloading', () => {
  it('is refused unless the customer turned it on', () => {
    // The default, and the reason the check is on the server: someone else's
    // wedding photographs are not a download because a button was rendered.
    expect(canDownload({ ...on, guestDownload: false })).toBe(false);
    expect(canDownload(on)).toBe(true);
  });
});

describe('what counts as being in the gallery', () => {
  it('needs all four conditions', () => {
    expect(isInGallery(media(), ALLOWED)).toBe(true);
    expect(isInGallery(media({ status: MediaState.HIDDEN }), ALLOWED)).toBe(false);
    expect(isInGallery(media({ visibility: MediaVisibility.UPLOADER }), ALLOWED)).toBe(false);
    expect(isInGallery(media({ moderationStatus: ModerationStatus.AWAITING }), ALLOWED)).toBe(
      false,
    );
  });

  it('counts approved as past moderation, and awaiting or rejected as not', () => {
    expect(isPastModeration(ModerationStatus.NOT_REQUIRED)).toBe(true);
    expect(isPastModeration(ModerationStatus.APPROVED)).toBe(true);
    expect(isPastModeration(ModerationStatus.AWAITING)).toBe(false);
    expect(isPastModeration(ModerationStatus.REJECTED)).toBe(false);
  });
});

describe('reading one item', () => {
  it('lets an invited guest read what is in the gallery', () => {
    expect(canReadMedia(media(), GUEST, ALLOWED)).toBe(true);
  });

  it('refuses a photograph from a ceremony this guest was not invited to', () => {
    // The cross-event and cross-ceremony case in one: the allowed list is
    // built from this guest's own group, on the server.
    expect(canReadMedia(media({ subEvent: 'sangeet' }), GUEST, ALLOWED)).toBe(false);
  });

  it('refuses a photograph still awaiting approval', () => {
    expect(
      canReadMedia(media({ moderationStatus: ModerationStatus.AWAITING }), GUEST, ALLOWED),
    ).toBe(false);
  });

  it('refuses one the customer rejected or hid', () => {
    expect(
      canReadMedia(media({ moderationStatus: ModerationStatus.REJECTED }), GUEST, ALLOWED),
    ).toBe(false);
    expect(canReadMedia(media({ status: MediaState.HIDDEN }), GUEST, ALLOWED)).toBe(false);
  });

  it('refuses one held back by a quality flag, when it is somebody else’s', () => {
    expect(canReadMedia(media({ visibility: MediaVisibility.UPLOADER }), GUEST, ALLOWED)).toBe(
      false,
    );
  });

  it('lets the uploader read their own in any state', () => {
    /*
     * The person who took the photograph can see what became of it — that is
     * what makes "this may not be clear enough" an offer rather than a
     * disappearance.
     */
    const mine = { ownerGuestId: GUEST };
    expect(
      canReadMedia(media({ ...mine, visibility: MediaVisibility.UPLOADER }), GUEST, ALLOWED),
    ).toBe(true);
    expect(
      canReadMedia(media({ ...mine, moderationStatus: ModerationStatus.AWAITING }), GUEST, ALLOWED),
    ).toBe(true);
    expect(canReadMedia(media({ ...mine, status: MediaState.HIDDEN }), GUEST, ALLOWED)).toBe(true);
    /* Even from a ceremony they can no longer see: it is still their photo. */
    expect(canReadMedia(media({ ...mine, subEvent: 'sangeet' }), GUEST, ALLOWED)).toBe(true);
  });
});

describe('overruling a quality flag', () => {
  it('is only ever the uploader’s to do', () => {
    expect(canOverride(media({ ownerGuestId: GUEST }), GUEST)).toBe(true);
    expect(canOverride(media({ ownerGuestId: OTHER }), GUEST)).toBe(false);
  });
});
