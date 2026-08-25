import { Types } from 'mongoose';
import {
  OnboardingStatus,
  OrganizerProfileDocument,
  OrganizerReviewAction,
  OrganizerReviewEntry,
  ReviewActorRole,
} from './schemas/organizer-profile.schema';

export interface ReviewEntryInput {
  action: OrganizerReviewAction;
  fromStatus: OnboardingStatus;
  toStatus: OnboardingStatus;
  actorRole: ReviewActorRole;
  actorId: string;
  actorName?: string;
  reason?: string;
  fields?: string[];
}

/**
 * Appends one audit entry. Single choke point for the trail, so every entry has
 * an actor and the Mongoose sub-document cast lives in exactly one place.
 */
export function appendReview(profile: OrganizerProfileDocument, input: ReviewEntryInput): void {
  const entry: OrganizerReviewEntry = {
    action: input.action,
    fromStatus: input.fromStatus,
    toStatus: input.toStatus,
    reason: input.reason ?? '',
    actorRole: input.actorRole,
    actor: new Types.ObjectId(input.actorId),
    actorName: input.actorName ?? '',
    fields: input.fields ?? [],
    at: new Date(),
  };
  (profile.reviewTrail as unknown as OrganizerReviewEntry[]).push(entry);
}
