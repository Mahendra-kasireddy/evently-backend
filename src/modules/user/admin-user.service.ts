import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User, UserDocument, UserStatus } from './schemas/user.schema';
import { ListUsersDto } from './dto/list-users.dto';
import { UserService } from './user.service';
import { PaginatedResult } from '../../common/dto/pagination.dto';
import { Role } from '../../common/enums/role.enum';
import { Booking, BookingDocument } from '../booking/schemas/booking.schema';
import { QuoteRequest, QuoteRequestDocument } from '../quote/schemas/quote-request.schema';
import { PlanSubmission, PlanSubmissionDocument } from '../plan/schemas/plan-submission.schema';

export const USER_STATUS_LABEL: Record<UserStatus, string> = {
  [UserStatus.ACTIVE]: 'Active',
  [UserStatus.SUSPENDED]: 'Suspended',
  // Closed by its holder, not by an admin — the console shows it, and the
  // suspend/reinstate controls do not apply to it.
  [UserStatus.DELETED]: 'Closed by user',
};

export const ROLE_LABEL: Record<Role, string> = {
  [Role.CUSTOMER]: 'Customer',
  [Role.ORGANIZER]: 'Organizer',
  [Role.VENDOR]: 'Vendor',
  [Role.ADMIN]: 'Admin',
};

/**
 * Admin account management.
 *
 * Read-and-suspend only by design: this service can change an account's status
 * and nothing else. Roles are deliberately not writable here — granting admin
 * is a bigger decision than this screen is built for, and leaving it out means
 * the console cannot be used to escalate privileges at all.
 */
@Injectable()
export class AdminUserService {
  private readonly logger = new Logger(AdminUserService.name);

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    /*
     * The models, not the owning services. BookingService already depends on
     * UserService transitively, so importing those modules here would build a
     * cycle. Only counts are read, and only for one account at a time.
     */
    @InjectModel(Booking.name) private readonly bookingModel: Model<BookingDocument>,
    @InjectModel(QuoteRequest.name) private readonly quoteModel: Model<QuoteRequestDocument>,
    @InjectModel(PlanSubmission.name) private readonly planModel: Model<PlanSubmissionDocument>,
    private readonly userService: UserService,
  ) {}

  async list(query: ListUsersDto): Promise<PaginatedResult<Record<string, unknown>>> {
    const filter: Record<string, unknown> = {};
    if (query.role) filter.roles = query.role;
    if (query.status) filter.status = query.status;

    const search = query.search?.trim();
    if (search) {
      // Escaped: a name can legitimately contain regex characters, and an
      // unescaped one would either throw or match far more than intended.
      const safe = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const rx = new RegExp(safe, 'i');
      filter.$or = [{ name: rx }, { email: rx }, { phone: rx }];
    }

    const [rows, total] = await Promise.all([
      this.userModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(query.skip)
        .limit(query.limit)
        .exec(),
      this.userModel.countDocuments(filter).exec(),
    ]);

    return {
      data: rows.map((u) => this.rowView(u)),
      meta: {
        total,
        page: query.page,
        limit: query.limit,
        pages: Math.max(1, Math.ceil(total / query.limit)),
      },
    };
  }

  /**
   * Counts for the filter chips: one per status, one per role, plus the total.
   * Roles overlap by design — a user who is both a customer and an organizer is
   * counted under both, because that is what filtering by either will return.
   */
  async counts(): Promise<Record<string, number>> {
    const [byStatus, byRole, all] = await Promise.all([
      this.userModel
        .aggregate<{ _id: UserStatus; n: number }>([{ $group: { _id: '$status', n: { $sum: 1 } } }])
        .exec(),
      this.userModel
        .aggregate<{
          _id: Role;
          n: number;
        }>([{ $unwind: '$roles' }, { $group: { _id: '$roles', n: { $sum: 1 } } }])
        .exec(),
      this.userModel.countDocuments().exec(),
    ]);

    const counts: Record<string, number> = { all };
    for (const status of Object.values(UserStatus)) counts[status] = 0;
    for (const role of Object.values(Role)) counts[role] = 0;
    for (const g of byStatus) counts[g._id] = g.n;
    for (const g of byRole) counts[g._id] = g.n;
    return counts;
  }

  /** One account, plus real counts of what it has actually done on Evently. */
  async detail(id: string): Promise<Record<string, unknown>> {
    const user = await this.load(id);
    const userId = user._id;

    const [bookings, quoteRequests, plans] = await Promise.all([
      this.bookingModel.countDocuments({ customer: userId }).exec(),
      this.quoteModel.countDocuments({ customer: userId }).exec(),
      // `customer`, not `user` — PlanSubmission names its owner the same way
      // Booking and QuoteRequest do.
      this.planModel.countDocuments({ customer: userId }).exec(),
    ]);

    return {
      ...this.rowView(user),
      activity: { bookings, quoteRequests, plans },
    };
  }

  /**
   * Suspend or reactivate an account.
   *
   * Suspending also drops the stored refresh-token hash: without that, a
   * suspended user's browser keeps rotating a valid refresh token and the
   * suspension does not take effect until they happen to log out. Their
   * current access token still works until it expires (one hour) — access
   * tokens are stateless and cannot be revoked, which is why the session is
   * cut at the refresh step instead.
   */
  async setStatus(
    id: string,
    status: UserStatus,
    actingAdminId: string,
  ): Promise<Record<string, unknown>> {
    const user = await this.load(id);

    if (user._id.toString() === actingAdminId && status === UserStatus.SUSPENDED) {
      throw new ForbiddenException('You cannot suspend your own account');
    }

    user.status = status;
    await user.save();

    if (status === UserStatus.SUSPENDED) {
      await this.userService.setRefreshTokenHash(user._id.toString(), null);
      this.logger.warn(
        `Account ${user._id.toString()} suspended by admin ${actingAdminId}; session revoked.`,
      );
    } else {
      this.logger.log(`Account ${user._id.toString()} reactivated by admin ${actingAdminId}.`);
    }

    return this.detail(user._id.toString());
  }

  private async load(id: string): Promise<UserDocument> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('User not found');
    const user = await this.userModel.findById(id).exec();
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  /**
   * The admin-facing shape. `passwordHash` and `refreshTokenHash` are `select:
   * false` on the schema and are not read here, so no credential material can
   * reach the console.
   */
  private rowView(u: UserDocument): Record<string, unknown> {
    const roles = (u.roles ?? []) as Role[];
    return {
      id: u._id.toString(),
      name: u.name ?? '',
      email: u.email ?? '',
      phone: u.phone ?? '',
      city: u.city ?? '',
      roles,
      roleLabels: roles.map((r) => ROLE_LABEL[r] ?? r),
      status: u.status,
      statusLabel: USER_STATUS_LABEL[u.status] ?? u.status,
      phoneVerified: u.phoneVerified ?? false,
      createdAt: (u as unknown as { createdAt?: Date }).createdAt ?? null,
      updatedAt: (u as unknown as { updatedAt?: Date }).updatedAt ?? null,
    };
  }
}
