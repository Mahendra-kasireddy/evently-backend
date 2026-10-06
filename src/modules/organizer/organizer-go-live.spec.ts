import { OrganizerOnboardingService } from './organizer-onboarding.service';
import { OnboardingStatus, OrganizerProfileDocument } from './schemas/organizer-profile.schema';
import { UserDocument } from '../user/schemas/user.schema';

/**
 * Progressive onboarding: sign-up opens the dashboard, every non-bank step is
 * needed to go live, and bank details are needed only before payouts — so
 * they stay addable after submission, but not changeable once on file.
 */
describe('organizer go-live rules', () => {
  // Only the pure helpers are exercised; no collaborator is touched.
  const service = new OrganizerOnboardingService(
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
  );
  const file = { url: 'https://x/f.png', key: 'k', originalName: 'f.png' };
  const user = { phone: '9800000000' } as unknown as UserDocument;

  const goLiveReady = {
    firstName: 'Meera',
    lastName: 'Rao',
    contactEmail: 'meera@example.com',
    businessName: 'Meera Events',
    businessType: 'agency',
    primaryCategory: 'wedding',
    city: 'Hyderabad',
    profilePhoto: file,
    aadhaarNumber: '123412341234',
    panNumber: 'ABCDE1234F',
    governmentIdType: 'aadhaar',
    governmentIdFile: file,
    panFile: file,
    experience: '3-5',
    teamSize: '5-10',
    languages: ['te'],
    occasions: ['wedding'],
    travelOption: 'city',
    workingDays: ['mon'],
    minBudget: 50000,
    maxBudget: 500000,
    businessDescription: 'We plan weddings.',
    coverPhoto: file,
    gallery: [file],
  };
  const bank = {
    accountHolderName: 'Meera Rao',
    bankName: 'SBI',
    accountNumber: '12345678901',
    ifsc: 'SBIN0000001',
    cancelledChequeFile: file,
  };

  const profile = (fields: Record<string, unknown>, status = OnboardingStatus.IN_PROGRESS) =>
    ({
      _id: { toString: () => 'p1' },
      onboardingStatus: status,
      profileCompletion: 0,
      submittedAt: null,
      reviewTrail: [],
      gallery: [],
      videos: [],
      certificates: [],
      awards: [],
      languages: [],
      occasions: [],
      workingDays: [],
      // toView reads timestamps the way a Mongoose document exposes them.
      get: () => null,
      ...fields,
    }) as unknown as OrganizerProfileDocument;

  it('does not ask for bank details to go live', () => {
    expect(service.goLiveFor(profile(goLiveReady)).missing).toEqual([]);
    expect(service.goLiveFor(profile(goLiveReady)).percent).toBe(100);
  });

  it('names what is still missing to go live', () => {
    const { missing } = service.goLiveFor(profile({ firstName: 'Meera' }));
    expect(missing).toContain('PAN number');
    expect(missing).toContain('Business name');
    expect(missing).not.toContain('IFSC');
  });

  it('keeps bank details addable after submission until they are on file', () => {
    const submitted = service.viewFor(profile(goLiveReady, OnboardingStatus.SUBMITTED), user);
    expect(submitted.canEdit).toBe(false);
    expect(submitted.canEditBank).toBe(true);
    expect(submitted.payoutReady).toBe(false);

    const live = service.viewFor(profile(goLiveReady, OnboardingStatus.APPROVED), user);
    expect(live.canEditBank).toBe(true);

    const paid = service.viewFor(
      profile({ ...goLiveReady, ...bank }, OnboardingStatus.APPROVED),
      user,
    );
    expect(paid.payoutReady).toBe(true);
    // Changing bank details after verification goes through support.
    expect(paid.canEditBank).toBe(false);
  });

  it('does not open bank details to a rejected organizer', () => {
    const rejected = service.viewFor(profile(goLiveReady, OnboardingStatus.REJECTED), user);
    expect(rejected.canEditBank).toBe(false);
  });
});
