import { Types } from 'mongoose';
import { InvitationDocument } from './schemas/invitation.schema';

/**
 * The story as a client reads it.
 *
 * Its own file rather than a method on either service: the organizer's view
 * and the guest's view both need it, and having one import the other would
 * couple two services that have no business knowing about each other — the
 * shape of a story card is not the property of whichever screen asked first.
 *
 * Always sorted by `order`, never by stored position, for the same reason the
 * field is stored at all.
 */
export function storyView(
  invitation: InvitationDocument,
  opts: { withKeys?: boolean } = {},
): Array<Record<string, unknown>> {
  return [...invitation.storyCards]
    .sort((a, b) => a.order - b.order)
    .map((c) => ({
      id: (c as { _id?: Types.ObjectId })._id?.toString() ?? '',
      imageUrl: c.imageUrl,
      /* The storage handle is the editor's business, never a guest's. */
      ...(opts.withKeys ? { imageKey: c.imageKey } : {}),
      caption: c.caption,
      order: c.order,
    }));
}
