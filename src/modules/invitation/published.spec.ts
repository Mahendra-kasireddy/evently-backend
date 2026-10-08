import { model, models, Model, Types } from 'mongoose';
import { contentOf, guestCopy, isLiveForGuests, withContent } from './published';
import {
  InvitationDocument,
  InvitationSchema,
  InvitationStatus,
} from './schemas/invitation.schema';

/*
 * One invitation, three versions: the organizer's working copy, the version
 * sent to the customer, and the version the customer approved for guests.
 * No database — documents are built and read in memory.
 */
const Inv = (models.PublishedSpecInvitation ??
  model('PublishedSpecInvitation', InvitationSchema)) as unknown as Model<InvitationDocument>;

function invitation(hostOne: string): InvitationDocument {
  return new Inv({
    booking: new Types.ObjectId(),
    organizer: new Types.ObjectId(),
    customer: new Types.ObjectId(),
    status: InvitationStatus.DRAFT,
    details: { hostOne, hostTwo: 'Diya', eventDate: '2026-11-06' },
    subEvents: [{ name: 'Sangeet', eventDate: '2026-11-05', liveEnabled: false }],
  });
}

describe('invitation versions', () => {
  it('reads a stored version back without touching the working copy', () => {
    const inv = invitation('Aarav');
    const sent = contentOf(inv);
    inv.details.hostOne = 'Changed after sending';

    expect(withContent(Inv, inv, sent).details.hostOne).toBe('Aarav');
    expect(inv.details.hostOne).toBe('Changed after sending');
  });

  it('shows guests the approved version, not later edits', () => {
    const inv = invitation('Aarav');
    inv.publishedContent = contentOf(inv);
    inv.status = InvitationStatus.SENT; // an update is out for review
    inv.details.hostOne = 'Unapproved edit';

    expect(isLiveForGuests(inv)).toBe(true);
    expect(guestCopy(Inv, inv).details.hostOne).toBe('Aarav');
  });

  it('takes a live stream from the working copy — starting it is not an edit to approve', () => {
    const inv = invitation('Aarav');
    inv.publishedContent = contentOf(inv);
    inv.subEvents[0].liveEnabled = true;
    inv.subEvents[0].liveUrl = 'https://www.youtube.com/embed/abc';

    const guest = guestCopy(Inv, inv);
    expect(guest.subEvents[0].name).toBe('Sangeet');
    expect(guest.subEvents[0].liveEnabled).toBe(true);
    expect(guest.subEvents[0].liveUrl).toBe('https://www.youtube.com/embed/abc');
  });

  it('is not live for guests until it has been approved once', () => {
    const inv = invitation('Aarav');
    inv.status = InvitationStatus.SENT;
    expect(isLiveForGuests(inv)).toBe(false);
  });

  it('treats an invitation approved before versions existed as live, on its working copy', () => {
    const inv = invitation('Aarav');
    inv.status = InvitationStatus.APPROVED;
    expect(isLiveForGuests(inv)).toBe(true);
    expect(guestCopy(Inv, inv).details.hostOne).toBe('Aarav');
  });
});
