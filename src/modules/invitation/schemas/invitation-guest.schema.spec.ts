import { GuestNotificationSchema, InvitationGuestSchema } from './invitation-guest.schema';

/*
 * The @Schema options once drifted onto the wrong class: GuestNotification was
 * inserted between the guest's decorator and its class, so guests were written
 * to a default "invitationguests" collection with no timestamps — and every
 * "Add guest" failed with a duplicate-key 500.
 */
describe('InvitationGuest schema', () => {
  it('writes to invitation_guests, with timestamps', () => {
    expect(InvitationGuestSchema.get('collection')).toBe('invitation_guests');
    expect(InvitationGuestSchema.get('timestamps')).toBe(true);
  });

  it('keeps GuestNotification an embedded sub-document', () => {
    expect(GuestNotificationSchema.get('_id')).toBe(false);
    expect(GuestNotificationSchema.get('collection')).toBeUndefined();
  });
});
