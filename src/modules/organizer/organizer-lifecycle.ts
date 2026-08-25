import { ConflictException, ForbiddenException } from '@nestjs/common';
import { OnboardingStatus } from './schemas/organizer-profile.schema';

/**
 * The organizer lifecycle, in one place.
 *
 * Every state change in the system goes through `assertTransition`, so an
 * invalid edge is impossible regardless of which caller attempts it — admin
 * endpoint, organizer endpoint or a future script. Notably
 * PENDING_REVIEW -> APPROVED is not an edge: an organizer cannot become live
 * without passing through onboarding and both admin gates.
 *
 *   PENDING_REVIEW ──admit──> DRAFT ──edit──> IN_PROGRESS ──submit──> SUBMITTED
 *         │                     │                 │                    │
 *         │                     └────submit───────┘                    ├─approve─> APPROVED
 *         │                                                            └─changes─> CHANGES_REQUESTED
 *         └──────────────────────reject──────────> REJECTED                   │
 *                                                      │                      │
 *                                                      └──reopen──> DRAFT     └──edit──> IN_PROGRESS
 */
export const ALLOWED_TRANSITIONS: Readonly<Record<OnboardingStatus, readonly OnboardingStatus[]>> =
  Object.freeze({
    // Gate 1. Registration is admitted to onboarding, or refused outright.
    [OnboardingStatus.PENDING_REVIEW]: [OnboardingStatus.DRAFT, OnboardingStatus.REJECTED],

    // Onboarding. DRAFT -> SUBMITTED is allowed for the (rare) case where every
    // required field arrives in a single save.
    [OnboardingStatus.DRAFT]: [
      OnboardingStatus.IN_PROGRESS,
      OnboardingStatus.SUBMITTED,
      OnboardingStatus.REJECTED,
    ],
    [OnboardingStatus.IN_PROGRESS]: [OnboardingStatus.SUBMITTED, OnboardingStatus.REJECTED],

    // Gate 2.
    [OnboardingStatus.SUBMITTED]: [
      OnboardingStatus.APPROVED,
      OnboardingStatus.CHANGES_REQUESTED,
      OnboardingStatus.REJECTED,
    ],

    // Sent back for edits: editing resumes onboarding, or it can be resubmitted
    // directly if the organizer only had to re-read something.
    [OnboardingStatus.CHANGES_REQUESTED]: [
      OnboardingStatus.IN_PROGRESS,
      OnboardingStatus.SUBMITTED,
      OnboardingStatus.REJECTED,
    ],

    // A live organizer can be taken down. Reinstating goes back through gate 2.
    [OnboardingStatus.APPROVED]: [OnboardingStatus.REJECTED, OnboardingStatus.CHANGES_REQUESTED],

    // A refused organizer can be let back into onboarding.
    [OnboardingStatus.REJECTED]: [OnboardingStatus.DRAFT],
  });

export function canTransition(from: OnboardingStatus, to: OnboardingStatus): boolean {
  return (ALLOWED_TRANSITIONS[from] ?? []).includes(to);
}

/** Throws 409 rather than silently writing an impossible state. */
export function assertTransition(from: OnboardingStatus, to: OnboardingStatus): void {
  if (from === to) {
    throw new ConflictException(`Organizer is already ${LABELS[to]}`);
  }
  if (!canTransition(from, to)) {
    throw new ConflictException(`Cannot move an organizer from ${LABELS[from]} to ${LABELS[to]}`);
  }
}

/**
 * States in which the organizer may write their own onboarding.
 *
 * PENDING_REVIEW is excluded on purpose — that is gate 1. Because the check
 * lives here and every write path calls it, navigating straight to the
 * onboarding URL gains nothing: the API refuses.
 */
const ORGANIZER_WRITABLE: ReadonlySet<OnboardingStatus> = new Set([
  OnboardingStatus.DRAFT,
  OnboardingStatus.IN_PROGRESS,
  OnboardingStatus.CHANGES_REQUESTED,
]);

/**
 * States in which an admin may write onboarding fields on the organizer's
 * behalf. Includes SUBMITTED — filling a gap is the common reason an admin
 * touches a profile at all — and excludes PENDING_REVIEW (nothing to fill in
 * before gate 1) and the terminal states.
 */
const ADMIN_WRITABLE: ReadonlySet<OnboardingStatus> = new Set([
  OnboardingStatus.DRAFT,
  OnboardingStatus.IN_PROGRESS,
  OnboardingStatus.SUBMITTED,
  OnboardingStatus.CHANGES_REQUESTED,
]);

export function canOrganizerEdit(status: OnboardingStatus): boolean {
  return ORGANIZER_WRITABLE.has(status);
}

export function canAdminEdit(status: OnboardingStatus): boolean {
  return ADMIN_WRITABLE.has(status);
}

/** Human-readable state names, used in errors and by the admin console. */
export const LABELS: Readonly<Record<OnboardingStatus, string>> = Object.freeze({
  [OnboardingStatus.PENDING_REVIEW]: 'pending admin review',
  [OnboardingStatus.DRAFT]: 'approved to onboard',
  [OnboardingStatus.IN_PROGRESS]: 'onboarding in progress',
  [OnboardingStatus.SUBMITTED]: 'submitted for review',
  [OnboardingStatus.CHANGES_REQUESTED]: 'changes requested',
  [OnboardingStatus.APPROVED]: 'active',
  [OnboardingStatus.REJECTED]: 'rejected',
});

/** Guard for the organizer's own onboarding writes. */
export function assertOrganizerCanEdit(status: OnboardingStatus): void {
  if (canOrganizerEdit(status)) return;
  if (status === OnboardingStatus.PENDING_REVIEW) {
    throw new ForbiddenException(
      'Your registration is still being reviewed by Evently. You can start onboarding once it is approved.',
    );
  }
  if (status === OnboardingStatus.SUBMITTED) {
    throw new ForbiddenException(
      'Your profile is being reviewed. You can edit it again if we ask for changes.',
    );
  }
  if (status === OnboardingStatus.APPROVED) {
    throw new ForbiddenException(
      'Your profile is live. Contact Evently support to change your verified details.',
    );
  }
  throw new ForbiddenException('Your organizer registration was not approved.');
}
