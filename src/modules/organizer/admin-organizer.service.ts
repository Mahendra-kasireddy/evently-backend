import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';

import {
  OnboardingStatus,
  OrganizerProfile,
  OrganizerProfileDocument,
  OrganizerReviewAction,
  ReviewActorRole,
} from './schemas/organizer-profile.schema';
import { assertTransition, canAdminEdit, canOrganizerEdit, LABELS } from './organizer-lifecycle';
import { appendReview } from './review-trail';
import { OrganizerOnboardingService } from './organizer-onboarding.service';
import { ListOrganizersDto } from './dto/list-organizers.dto';
import { AdminUpdateOnboardingDto } from './dto/admin-update-onboarding.dto';
import { User, UserDocument } from '../user/schemas/user.schema';
import { UserService } from '../user/user.service';
import { NotificationService } from '../notification/notification.service';
import { NotificationType } from '../notification/schemas/notification.schema';
import { PaginatedResult } from '../../common/dto/pagination.dto';

/** One row in the admin list. Only fields that actually exist on the record. */
export interface OrganizerRow {
  id: string;
  userId: string;
  businessName: string;
  contactName: string;
  mobile: string;
  city: string;
  status: OnboardingStatus;
  statusLabel: string;
  profileCompletion: number;
  registeredAt: string;
  submittedAt: string | null;
  live: boolean;
}

export interface ReviewTrailEntryView {
  action: OrganizerReviewAction;
  fromStatus: OnboardingStatus;
  toStatus: OnboardingStatus;
  reason: string;
  actorRole: ReviewActorRole;
  actorName: string;
  fields: string[];
  at: string;
}

@Injectable()
export class AdminOrganizerService {
  private readonly logger = new Logger(AdminOrganizerService.name);

  constructor(
    @InjectModel(OrganizerProfile.name)
    private readonly profileModel: Model<OrganizerProfileDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    private readonly onboarding: OrganizerOnboardingService,
    private readonly userService: UserService,
    private readonly notificationService: NotificationService,
  ) {}

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  /**
   * Only self-registered organizers — profiles with a linked user account.
   *
   * The collection also holds seeded marketing profiles with no `user`. Those
   * are catalogue entries, not registrations: they never went through OTP, have
   * nobody to approve, and must not appear in a review queue.
   */
  private baseFilter(): FilterQuery<OrganizerProfileDocument> {
    return { user: { $exists: true, $ne: null }, deletedAt: null };
  }

  async list(query: ListOrganizersDto): Promise<PaginatedResult<OrganizerRow>> {
    const filter: FilterQuery<OrganizerProfileDocument> = this.baseFilter();
    if (query.status) filter.onboardingStatus = query.status;

    const search = (query.search ?? '').trim();
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(escaped, 'i');
      const or: FilterQuery<OrganizerProfileDocument>[] = [
        { businessName: re },
        { displayName: re },
        { firstName: re },
        { lastName: re },
        { name: re },
        { city: re },
      ];
      // A digit-ish search is probably a phone number, which lives on the user.
      if (/\d/.test(search)) {
        const userIds = await this.userModel
          .find({ phone: re })
          .select('_id')
          .limit(200)
          .lean()
          .exec();
        if (userIds.length > 0) or.push({ user: { $in: userIds.map((u) => u._id) } });
      }
      filter.$or = or;
    }

    const [total, profiles] = await Promise.all([
      this.profileModel.countDocuments(filter).exec(),
      this.profileModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(query.skip)
        .limit(query.limit)
        .exec(),
    ]);

    const users = await this.usersFor(profiles);
    return {
      data: profiles.map((p) => this.toRow(p, users.get(String(p.user)))),
      meta: {
        total,
        page: query.page,
        limit: query.limit,
        pages: Math.max(1, Math.ceil(total / query.limit)),
      },
    };
  }

  /** Real counts per state, for the filter chips. Never a hardcoded number. */
  async counts(): Promise<Record<string, number>> {
    const rows = await this.profileModel
      .aggregate<{
        _id: OnboardingStatus;
        n: number;
      }>([{ $match: this.baseFilter() }, { $group: { _id: '$onboardingStatus', n: { $sum: 1 } } }])
      .exec();

    const counts: Record<string, number> = { all: 0 };
    for (const status of Object.values(OnboardingStatus)) counts[status] = 0;
    for (const row of rows) {
      counts[row._id] = row.n;
      counts.all += row.n;
    }
    return counts;
  }

  /**
   * Full detail. The onboarding payload comes from the organizer's own view
   * builder, so admin and organizer read one source of truth.
   */
  async detail(id: string) {
    const { profile, user } = await this.load(id);
    const steps = this.onboarding.stepsFor(profile);
    const completion = this.onboarding.completionFor(profile);

    return {
      ...this.toRow(profile, user),
      email: user?.email ?? '',
      accountRoles: user?.roles ?? [],
      accountStatus: user?.status ?? null,
      onboarding: this.onboarding.viewFor(profile, user ?? ({} as UserDocument)),
      steps,
      missingFields: completion.missing,
      canOrganizerEdit: canOrganizerEdit(profile.onboardingStatus),
      canAdminEdit: canAdminEdit(profile.onboardingStatus),
      reviewTrail: this.trailView(profile),
    };
  }

  // ---------------------------------------------------------------------------
  // Decisions
  // ---------------------------------------------------------------------------

  /**
   * One approval action whose meaning depends on where the organizer is:
   *   pending_review -> draft     gate 1, admitted to onboarding
   *   submitted      -> approved  gate 2, profile goes live
   * Anything else is refused by the transition table.
   */
  async approve(id: string, adminId: string) {
    const { profile } = await this.load(id);
    const from = profile.onboardingStatus;

    if (from === OnboardingStatus.PENDING_REVIEW) {
      await this.transition(profile, OnboardingStatus.DRAFT, adminId, {
        action: OrganizerReviewAction.ADMITTED,
      });
      await this.notifyOrganizer(
        profile,
        'Registration approved',
        'Your organizer registration has been approved. You can now complete your onboarding.',
      );
    } else if (from === OnboardingStatus.REJECTED) {
      await this.transition(profile, OnboardingStatus.DRAFT, adminId, {
        action: OrganizerReviewAction.REOPENED,
      });
      await this.notifyOrganizer(
        profile,
        'Registration reopened',
        'Your organizer registration has been reopened. You can continue your onboarding.',
      );
    } else {
      // Gate 2 — refuse to publish an incomplete profile even on admin action.
      const completion = this.onboarding.completionFor(profile);
      if (completion.percent < 100) {
        throw new BadRequestException(
          `Onboarding is only ${completion.percent}% complete. Outstanding: ${completion.missing.join(', ')}`,
        );
      }
      await this.transition(profile, OnboardingStatus.APPROVED, adminId, {
        action: OrganizerReviewAction.APPROVED,
        live: true,
      });
      await this.notifyOrganizer(
        profile,
        'Profile approved',
        'Your organizer profile has been approved and is now visible to customers.',
      );
    }

    this.logger.log(
      `Admin ${adminId} approved organizer ${id}: ${from} -> ${profile.onboardingStatus}`,
    );
    return this.detail(profile._id.toString());
  }

  async reject(id: string, adminId: string, reason: string) {
    const { profile } = await this.load(id);
    const from = profile.onboardingStatus;
    await this.transition(profile, OnboardingStatus.REJECTED, adminId, {
      action: OrganizerReviewAction.REJECTED,
      reason,
      live: false,
    });
    await this.notifyOrganizer(
      profile,
      'Registration not approved',
      `Your organizer registration was not approved. Reason: ${reason}`,
    );
    this.logger.log(`Admin ${adminId} rejected organizer ${id} from ${from}`);
    return this.detail(profile._id.toString());
  }

  async requestChanges(id: string, adminId: string, reason: string) {
    const { profile } = await this.load(id);
    await this.transition(profile, OnboardingStatus.CHANGES_REQUESTED, adminId, {
      action: OrganizerReviewAction.CHANGES_REQUESTED,
      reason,
      live: false,
    });
    await this.notifyOrganizer(
      profile,
      'Changes requested',
      `We need a few changes before your profile can go live. ${reason}`,
    );
    return this.detail(profile._id.toString());
  }

  // ---------------------------------------------------------------------------
  // Admin editing of onboarding fields
  // ---------------------------------------------------------------------------

  /**
   * Writes only the keys present in the body, so nothing the organizer entered
   * is cleared by omission, and records which fields the admin touched. Values
   * were validated by the organizer's own DTOs before reaching here.
   */
  async updateOnboarding(id: string, adminId: string, dto: AdminUpdateOnboardingDto) {
    const { profile } = await this.load(id);

    if (!canAdminEdit(profile.onboardingStatus)) {
      throw new BadRequestException(
        `An organizer that is ${LABELS[profile.onboardingStatus]} cannot be edited`,
      );
    }

    const changed: string[] = [];
    const record = profile as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(dto)) {
      if (value === undefined) continue;
      const before = JSON.stringify(record[key] ?? null);
      const after = JSON.stringify(value);
      if (before === after) continue;
      record[key] = value;
      changed.push(key);
    }

    if (changed.length === 0) {
      throw new BadRequestException('Nothing to update');
    }

    this.onboarding.recomputeCompletion(profile);
    appendReview(profile, {
      action: OrganizerReviewAction.ADMIN_EDIT,
      fromStatus: profile.onboardingStatus,
      toStatus: profile.onboardingStatus,
      actorRole: ReviewActorRole.ADMIN,
      actorId: adminId,
      actorName: await this.adminName(adminId),
      fields: changed,
    });
    await profile.save();

    await this.notifyOrganizer(
      profile,
      'Your profile was updated by Evently',
      `Our team filled in: ${changed.join(', ')}. Please review the details are correct.`,
    );
    this.logger.log(`Admin ${adminId} edited organizer ${id}: ${changed.join(',')}`);
    return this.detail(profile._id.toString());
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async transition(
    profile: OrganizerProfileDocument,
    to: OnboardingStatus,
    adminId: string,
    opts: { action: OrganizerReviewAction; reason?: string; live?: boolean },
  ): Promise<void> {
    const from = profile.onboardingStatus;
    assertTransition(from, to);

    profile.onboardingStatus = to;
    if (opts.live !== undefined) profile.active = opts.live;

    appendReview(profile, {
      action: opts.action,
      fromStatus: from,
      toStatus: to,
      actorRole: ReviewActorRole.ADMIN,
      actorId: adminId,
      actorName: await this.adminName(adminId),
      ...(opts.reason ? { reason: opts.reason } : {}),
    });
    await profile.save();
  }

  private async load(
    id: string,
  ): Promise<{ profile: OrganizerProfileDocument; user: UserDocument | undefined }> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Organizer not found');
    const profile = await this.profileModel.findOne({ _id: id, ...this.baseFilter() }).exec();
    if (!profile) throw new NotFoundException('Organizer not found');
    const user = profile.user
      ? ((await this.userModel.findById(profile.user).exec()) ?? undefined)
      : undefined;
    return { profile, user };
  }

  private async usersFor(profiles: OrganizerProfileDocument[]): Promise<Map<string, UserDocument>> {
    const ids = profiles.map((p) => p.user).filter((u): u is Types.ObjectId => !!u);
    if (ids.length === 0) return new Map();
    const users = await this.userModel.find({ _id: { $in: ids } }).exec();
    return new Map(users.map((u) => [u._id.toString(), u]));
  }

  private toRow(profile: OrganizerProfileDocument, user: UserDocument | undefined): OrganizerRow {
    const contactName = `${profile.firstName} ${profile.lastName}`.trim();
    const created = (profile as unknown as { createdAt?: Date }).createdAt;
    return {
      id: profile._id.toString(),
      userId: profile.user ? profile.user.toString() : '',
      businessName: profile.businessName,
      contactName: contactName || user?.name || '',
      mobile: user?.phone ?? '',
      city: profile.city,
      status: profile.onboardingStatus,
      statusLabel: LABELS[profile.onboardingStatus],
      profileCompletion: profile.profileCompletion,
      registeredAt: created ? created.toISOString() : '',
      submittedAt: profile.submittedAt ? profile.submittedAt.toISOString() : null,
      live: profile.active,
    };
  }

  private trailView(profile: OrganizerProfileDocument): ReviewTrailEntryView[] {
    const trail = profile.reviewTrail ?? [];
    return trail
      .map((e) => ({
        action: e.action,
        fromStatus: e.fromStatus,
        toStatus: e.toStatus,
        reason: e.reason ?? '',
        actorRole: e.actorRole,
        actorName: e.actorName ?? '',
        fields: e.fields ?? [],
        at: e.at ? new Date(e.at).toISOString() : '',
      }))
      .reverse();
  }

  private async adminName(adminId: string): Promise<string> {
    try {
      const admin = await this.userService.findById(adminId);
      return admin.name || admin.phone || '';
    } catch {
      return '';
    }
  }

  private async notifyOrganizer(
    profile: OrganizerProfileDocument,
    title: string,
    body: string,
  ): Promise<void> {
    if (!profile.user) return;
    try {
      await this.notificationService.create(
        profile.user.toString(),
        title,
        body,
        NotificationType.SYSTEM,
        '/onboarding/organizer',
      );
    } catch (err) {
      this.logger.warn(`Organizer review notification failed: ${String(err)}`);
    }
  }
}
