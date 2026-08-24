import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  SubVendorProfile,
  SubVendorProfileDocument,
  SubVendorCategory,
} from './schemas/subvendor-profile.schema';
import {
  SubVendorLink,
  SubVendorLinkDocument,
  SubVendorLinkStatus,
} from './schemas/subvendor-link.schema';
import { OnboardSubvendorDto } from './dto/onboard-subvendor.dto';
import { UserService } from '../user/user.service';
import { OrganizerService } from '../organizer/organizer.service';
import { AuthService } from '../auth/auth.service';
import { NotificationService } from '../notification/notification.service';
import { NotificationType } from '../notification/schemas/notification.schema';
import { Role } from '../../common/enums/role.enum';

const CATEGORY_UNIT: Record<SubVendorCategory, string> = {
  [SubVendorCategory.FOOD]: 'plate',
  [SubVendorCategory.WATER]: 'bottle',
  [SubVendorCategory.DECOR]: 'event',
  [SubVendorCategory.PHOTOGRAPHY]: 'day',
  [SubVendorCategory.MUSIC]: 'event',
  [SubVendorCategory.TRANSPORT]: 'trip',
  [SubVendorCategory.PRIEST]: 'ceremony',
  [SubVendorCategory.MEHENDI]: 'hand',
};

export interface SubVendorProfileView {
  id: string;
  fullName: string;
  initials: string;
  avatarColor: string;
  category: SubVendorCategory;
  serviceArea: string;
  baseRate: number;
  baseRateUnit: string;
  minOrder: number;
}

export interface OrganizerRef {
  id: string;
  name: string;
}

@Injectable()
export class SubvendorService {
  private readonly logger = new Logger(SubvendorService.name);

  constructor(
    @InjectModel(SubVendorProfile.name)
    private readonly subVendorModel: Model<SubVendorProfileDocument>,
    @InjectModel(SubVendorLink.name) private readonly linkModel: Model<SubVendorLinkDocument>,
    private readonly userService: UserService,
    private readonly organizerService: OrganizerService,
    private readonly authService: AuthService,
    private readonly notificationService: NotificationService,
  ) {}

  private initialsOf(name: string): string {
    return name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join('');
  }

  private toView(doc: SubVendorProfileDocument): SubVendorProfileView {
    return {
      id: doc._id.toString(),
      fullName: doc.fullName,
      initials: doc.initials,
      avatarColor: doc.avatarColor,
      category: doc.category,
      serviceArea: doc.serviceArea,
      baseRate: doc.baseRate,
      baseRateUnit: doc.baseRateUnit,
      minOrder: doc.minOrder,
    };
  }

  private async notify(
    userId: string,
    title: string,
    body: string,
    link = '/subvendor/home',
  ): Promise<void> {
    try {
      await this.notificationService.create(userId, title, body, NotificationType.SYSTEM, link);
    } catch (err) {
      this.logger.warn(`Sub-vendor notification failed: ${String(err)}`);
    }
  }

  findByUser(userId: string): Promise<SubVendorProfileDocument | null> {
    if (!Types.ObjectId.isValid(userId)) return Promise.resolve(null);
    return this.subVendorModel.findOne({ user: new Types.ObjectId(userId) }).exec();
  }

  async findById(id: string): Promise<SubVendorProfileDocument> {
    const doc = await this.subVendorModel.findById(id).exec();
    if (!doc) throw new NotFoundException('Sub-vendor not found');
    return doc;
  }

  private async profileId(userId: string): Promise<Types.ObjectId> {
    const profile = await this.findByUser(userId);
    if (!profile) throw new ForbiddenException('No sub-vendor profile is linked to your account');
    return profile._id;
  }

  /**
   * One-shot onboarding — the wizard collects everything client-side and
   * submits once (mirrors the existing frontend `finishSubvendorOnboarding`
   * call shape). Adds the VENDOR role, creates the profile, and resolves any
   * pending link either direction (an organizer's earlier invite to this
   * phone, or an organizer phone entered here).
   */
  async onboard(
    userId: string,
    dto: OnboardSubvendorDto,
  ): Promise<{ profile: SubVendorProfileView; token: string; refreshToken: string }> {
    const user = await this.userService.addRole(userId, Role.VENDOR);

    let profile = await this.findByUser(userId);
    if (!profile) {
      profile = await this.subVendorModel.create({
        user: new Types.ObjectId(userId),
        fullName: dto.fullName || user.name || 'New sub-vendor',
        initials: this.initialsOf(dto.fullName || user.name || 'SV'),
        category: dto.categoryId,
        serviceArea: dto.serviceArea ?? '',
        baseRate: dto.baseRate ?? 0,
        baseRateUnit: CATEGORY_UNIT[dto.categoryId],
        minOrder: dto.minOrder ?? 0,
        active: true,
      });
      await this.notify(
        userId,
        'Welcome to Evently for Sub-vendors',
        'Your sub-vendor profile is live. Accept tasks from organizers to start earning.',
      );
    }

    /*
     * Resolve a pending invite an organizer sent to this phone earlier.
     *
     * The emptiness guard is load-bearing, not defensive noise. `User.phone` is
     * optional and is never set on an account created through `registerUser`
     * (email + password), and Mongoose strips `undefined` from a query filter —
     * so `{ invitedPhone: undefined, status: PENDING }` collapses to
     * `{ status: PENDING }`, and this `updateMany` would claim EVERY pending
     * invite on the platform for this one profile and flip them all ACTIVE:
     * cross-tenant corruption of every organizer's invite list, plus read
     * access to those organizers' bookings via `GET /booking/subvendor/mine`.
     */
    const invitedPhone = (user.phone ?? '').trim();
    if (invitedPhone) {
      await this.linkModel.updateMany(
        { invitedPhone, status: SubVendorLinkStatus.PENDING },
        { $set: { subVendor: profile._id, status: SubVendorLinkStatus.ACTIVE } },
      );
    }

    // Link directly to an organizer whose phone was entered in this step.
    if (dto.organizerPhone) {
      const orgUser = await this.userService.findByPhone(dto.organizerPhone);
      const orgProfile = orgUser
        ? await this.organizerService.findByUser(orgUser._id.toString())
        : null;
      if (orgProfile) {
        const existing = await this.linkModel
          .findOne({ organizer: orgProfile._id, subVendor: profile._id })
          .exec();
        if (!existing) {
          await this.linkModel.create({
            organizer: orgProfile._id,
            subVendor: profile._id,
            status: SubVendorLinkStatus.ACTIVE,
          });
        } else if (existing.status !== SubVendorLinkStatus.ACTIVE) {
          existing.status = SubVendorLinkStatus.ACTIVE;
          await existing.save();
        }
        if (orgProfile.user) {
          await this.notify(
            orgProfile.user.toString(),
            'New sub-vendor linked',
            `${profile.fullName} linked their sub-vendor account to you.`,
            '/organizer/subvendors',
          );
        }
      }
    }

    const tokens = await this.authService.issueSessionForUser(userId);
    return {
      profile: this.toView(profile),
      token: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    };
  }

  async getProfile(userId: string): Promise<SubVendorProfileView> {
    const profile = await this.findByUser(userId);
    if (!profile) throw new NotFoundException('Sub-vendor profile not found');
    return this.toView(profile);
  }

  /** Organizers linked (active) to this sub-vendor — P-14 "My organizers". */
  async myOrganizers(userId: string): Promise<OrganizerRef[]> {
    const id = await this.profileId(userId);
    const links = await this.linkModel
      .find({ subVendor: id, status: SubVendorLinkStatus.ACTIVE })
      .populate('organizer', 'name')
      .exec();
    return links
      .map((l) => l.organizer as unknown as { _id: Types.ObjectId; name?: string })
      .filter((o) => !!o)
      .map((o) => ({ id: o._id.toString(), name: o.name ?? '' }));
  }

  /** Average of every organizer rating this sub-vendor has received, across all links. 0 if none yet. */
  async avgRating(subVendorId: Types.ObjectId): Promise<number> {
    const links = await this.linkModel
      .find({ subVendor: subVendorId, ratingCount: { $gt: 0 } })
      .exec();
    if (!links.length) return 0;
    const total = links.reduce((sum, l) => sum + l.ratingTotal, 0);
    const count = links.reduce((sum, l) => sum + l.ratingCount, 0);
    return count > 0 ? total / count : 0;
  }

  // ---------------------------------------------------------------------------
  // Organizer-side management
  // ---------------------------------------------------------------------------

  private async organizerProfileId(userId: string): Promise<Types.ObjectId> {
    const profile = await this.organizerService.findByUser(userId);
    if (!profile) throw new ForbiddenException('No organizer profile is linked to your account');
    return profile._id;
  }

  /** All sub-vendors linked to this organizer (active + pending invites). */
  async listForOrganizer(userId: string): Promise<Record<string, unknown>[]> {
    const orgId = await this.organizerProfileId(userId);
    const links = await this.linkModel
      .find({ organizer: orgId, status: { $ne: SubVendorLinkStatus.REMOVED } })
      .populate('subVendor')
      .sort({ createdAt: -1 })
      .exec();
    return links.map((l) => {
      const sv = l.subVendor as unknown as SubVendorProfileDocument | undefined;
      return {
        linkId: l._id.toString(),
        status: l.status,
        invitedPhone: l.invitedPhone ?? null,
        // When the organizer sent the invite — drives the "Sent 2 days ago"
        // line on pending invites.
        invitedAt: l.createdAt ?? null,
        rating: l.ratingCount > 0 ? l.ratingTotal / l.ratingCount : 0,
        subVendor: sv
          ? {
              id: sv._id.toString(),
              fullName: sv.fullName,
              initials: sv.initials,
              avatarColor: sv.avatarColor,
              category: sv.category,
              serviceArea: sv.serviceArea,
              baseRate: sv.baseRate,
              baseRateUnit: sv.baseRateUnit,
              // The sub-vendor's own availability, distinct from the link
              // status: a linked sub-vendor can still mark themselves inactive.
              active: sv.active,
            }
          : null,
      };
    });
  }

  /** Invite a phone number — resolves immediately if that phone already has a sub-vendor profile. */
  async invite(userId: string, phone: string): Promise<Record<string, unknown>> {
    const orgId = await this.organizerProfileId(userId);
    const invitedUser = await this.userService.findByPhone(phone);
    const existingProfile = invitedUser ? await this.findByUser(invitedUser._id.toString()) : null;

    if (existingProfile) {
      const existingLink = await this.linkModel
        .findOne({ organizer: orgId, subVendor: existingProfile._id })
        .exec();
      if (existingLink) {
        if (existingLink.status === SubVendorLinkStatus.REMOVED) {
          existingLink.status = SubVendorLinkStatus.ACTIVE;
          await existingLink.save();
        }
        return { linkId: existingLink._id.toString(), status: existingLink.status };
      }
      const created = await this.linkModel.create({
        organizer: orgId,
        subVendor: existingProfile._id,
        status: SubVendorLinkStatus.ACTIVE,
      });
      await this.notify(
        existingProfile.user.toString(),
        'An organizer added you',
        'An organizer linked you as a sub-vendor. Check your dashboard for tasks.',
        '/subvendor/home',
      );
      return { linkId: created._id.toString(), status: created.status };
    }

    const existingInvite = await this.linkModel
      .findOne({
        organizer: orgId,
        invitedPhone: phone,
        status: { $ne: SubVendorLinkStatus.REMOVED },
      })
      .exec();
    if (existingInvite)
      return { linkId: existingInvite._id.toString(), status: existingInvite.status };

    const created = await this.linkModel.create({
      organizer: orgId,
      invitedPhone: phone,
      status: SubVendorLinkStatus.PENDING,
    });
    return { linkId: created._id.toString(), status: created.status };
  }

  async remove(userId: string, linkId: string): Promise<void> {
    const orgId = await this.organizerProfileId(userId);
    const link = await this.linkModel.findOne({ _id: linkId, organizer: orgId }).exec();
    if (!link) throw new NotFoundException('Link not found');
    link.status = SubVendorLinkStatus.REMOVED;
    await link.save();
  }

  async rate(userId: string, linkId: string, rating: number): Promise<void> {
    const orgId = await this.organizerProfileId(userId);
    const link = await this.linkModel.findOne({ _id: linkId, organizer: orgId }).exec();
    if (!link) throw new NotFoundException('Link not found');
    link.ratingTotal += rating;
    link.ratingCount += 1;
    await link.save();
  }

  /** Active sub-vendor links for an organizer, for the task-assignment picker. */
  async activeLinksFor(
    organizerProfileId: Types.ObjectId,
  ): Promise<Array<{ id: string; fullName: string }>> {
    const links = await this.linkModel
      .find({
        organizer: organizerProfileId,
        status: SubVendorLinkStatus.ACTIVE,
        subVendor: { $ne: null },
      })
      .populate('subVendor', 'fullName')
      .exec();
    return links
      .map((l) => l.subVendor as unknown as { _id: Types.ObjectId; fullName?: string } | undefined)
      .filter((sv): sv is { _id: Types.ObjectId; fullName?: string } => !!sv)
      .map((sv) => ({ id: sv._id.toString(), fullName: sv.fullName ?? '' }));
  }

  /** Confirms `subVendorId` is actually linked (active) to this organizer — used when assigning a task. */
  async assertLinked(
    organizerProfileId: Types.ObjectId,
    subVendorId: string,
  ): Promise<SubVendorProfileDocument> {
    const link = await this.linkModel
      .findOne({
        organizer: organizerProfileId,
        subVendor: new Types.ObjectId(subVendorId),
        status: SubVendorLinkStatus.ACTIVE,
      })
      .exec();
    if (!link) throw new ForbiddenException('This sub-vendor is not linked to you');
    return this.findById(subVendorId);
  }
}
