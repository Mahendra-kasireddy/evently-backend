import { MediaState } from './memory.constants';
import { MediaVisibility, ModerationStatus } from '../schemas/invitation-media.schema';

/**
 * Who may see and do what.
 *
 * Every access decision in Shared Memories, as functions with no database and
 * no request — so the rules can be stated in a spec and argued with, rather
 * than inferred from the behaviour of a service that needs a Mongo to run.
 *
 * The service holds no access logic of its own: it resolves identity from the
 * token, loads the row, and asks these.
 */

export interface MemorySettings {
  enabled?: boolean;
  guestUpload?: boolean;
  guestView?: boolean;
  guestDownload?: boolean;
  moderation?: boolean;
}

/** The state of one item, as far as access is concerned. */
export interface MediaFacts {
  ownerGuestId: string;
  subEvent: string;
  status: MediaState;
  visibility: MediaVisibility;
  moderationStatus: ModerationStatus;
}

/** Off at the top switch means the feature does not exist for anybody. */
export function canViewGallery(settings: MemorySettings | undefined): boolean {
  return Boolean(settings?.enabled && settings.guestView);
}

export function canUpload(settings: MemorySettings | undefined, windowOpen: boolean): boolean {
  return Boolean(settings?.enabled && settings.guestUpload && windowOpen);
}

/**
 * Downloads are off unless the customer turned them on.
 *
 * Someone else's wedding photographs are not a download by default, and the
 * decision is the customer's — not the organizer's, and certainly not the
 * client's, which is why this is asked on the server before a url is put in
 * any answer.
 */
export function canDownload(settings: MemorySettings | undefined): boolean {
  return Boolean(settings?.enabled && settings.guestDownload);
}

/** Past moderation: either it was never needed, or a person approved it. */
export function isPastModeration(status: ModerationStatus): boolean {
  return status === ModerationStatus.NOT_REQUIRED || status === ModerationStatus.APPROVED;
}

/**
 * In the gallery for everyone who may see its celebration.
 *
 * All four conditions, because each is a different way for an item to be out:
 * hidden by the customer, held back by a quality flag, waiting for approval,
 * or belonging to a ceremony this guest was not invited to.
 */
export function isInGallery(media: MediaFacts, allowedSubEvents: string[]): boolean {
  return (
    media.status === MediaState.PUBLISHED &&
    media.visibility === MediaVisibility.GALLERY &&
    isPastModeration(media.moderationStatus) &&
    allowedSubEvents.includes(media.subEvent)
  );
}

/**
 * Whether one guest may read one item.
 *
 * Their own, whatever state it is in — the person who took a photograph can
 * see what became of it — or anything that is in the gallery for them. A guest
 * asking about an id that exists but is neither gets the same answer as one
 * asking about an id that does not exist at all, because the difference is
 * itself information about somebody else's celebration.
 */
export function canReadMedia(
  media: MediaFacts,
  guestId: string,
  allowedSubEvents: string[],
): boolean {
  if (media.ownerGuestId === guestId) return true;
  return isInGallery(media, allowedSubEvents);
}

/** Only the uploader may overrule a quality flag, and only on their own. */
export function canOverride(media: MediaFacts, guestId: string): boolean {
  return media.ownerGuestId === guestId;
}
