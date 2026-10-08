import type { Model } from 'mongoose';
import {
  InvitationContent,
  InvitationDocument,
  InvitationStatus,
} from './schemas/invitation.schema';

/*
 * The invitation is reviewed and approved as one piece, in versions:
 *
 *   working copy      what the organizer is editing (the document's own fields)
 *   sentContent       what they last sent — what the customer reviews
 *   publishedContent  what the customer last approved — what guests see
 *
 * These helpers read a stored version back as an ordinary (unsaved) invitation
 * document, so every existing view builder works on it unchanged.
 */

/** The fields a live stream runs on — operational, never versioned. */
const LIVE_FIELDS = [
  'liveEnabled',
  'liveTitle',
  'liveUrl',
  'live360Url',
  'liveVrUrl',
  'liveStartedAt',
] as const;

/** The editable parts of the working copy, as plain data. */
export function contentOf(invitation: InvitationDocument): InvitationContent {
  const o = invitation.toObject({ depopulate: true }) as unknown as InvitationContent;
  // A plain-data deep copy: a stored version must not share objects with the
  // working copy it was taken from.
  return JSON.parse(
    JSON.stringify({
      details: o.details,
      blocks: o.blocks,
      subEvents: o.subEvents,
      storyCards: o.storyCards,
    }),
  ) as InvitationContent;
}

/**
 * The invitation as it stood in a stored version — an unsaved document built
 * through the model, so every value is cast exactly as a loaded one would be.
 * Without a stored version (an invitation from before versions existed) it is
 * the working copy itself.
 */
export function withContent(
  model: Model<InvitationDocument>,
  invitation: InvitationDocument,
  content: InvitationContent | null | undefined,
): InvitationDocument {
  if (!content) return invitation;
  return new model({ ...invitation.toObject({ depopulate: true }), ...content });
}

/** Whether guests can open it: it has been approved at least once. */
export function isLiveForGuests(invitation: InvitationDocument): boolean {
  return !!invitation.publishedContent || invitation.status === InvitationStatus.APPROVED;
}

/**
 * The invitation as guests see it: the last approved version, with each
 * sub-event's live stream taken from the working copy — starting the stream
 * on the day is not an edit for the customer to approve, and a stream left on
 * the approved snapshot would never go live.
 */
export function guestCopy(
  model: Model<InvitationDocument>,
  invitation: InvitationDocument,
): InvitationDocument {
  const published = invitation.publishedContent;
  if (!published) return invitation;

  const current = new Map(
    (invitation.toObject({ depopulate: true }).subEvents ?? []).map(
      (e: Record<string, unknown>) => [String(e._id ?? ''), e],
    ),
  );
  const subEvents = (published.subEvents ?? []).map((e) => {
    const live = current.get(String((e as unknown as { _id?: unknown })._id ?? ''));
    if (!live) return e;
    const overlay: Record<string, unknown> = {};
    for (const field of LIVE_FIELDS) overlay[field] = live[field];
    return { ...e, ...overlay };
  });
  return withContent(model, invitation, { ...published, subEvents } as InvitationContent);
}
