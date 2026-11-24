import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Role } from '../../common/enums/role.enum';
import { User, UserDocument } from './schemas/user.schema';
import { AdminInvite, AdminInviteDocument, AdminInviteStatus } from './schemas/admin-invite.schema';
import { InviteAdminDto } from './dto/invite-admin.dto';

export interface AdminMemberView {
  id: string;
  name: string;
  phone: string;
  since: Date | null;
  isYou: boolean;
}

export interface AdminInviteView {
  id: string;
  name: string;
  phone: string;
  invitedBy: string;
  createdAt: Date | null;
}

/**
 * Who can use the admin console, and how someone new joins it.
 *
 * Granting admin is invite-only: an admin names a mobile number here, and the
 * person behind it signs up on the console with an OTP to that number
 * (`AuthService.verifyOtp` calls `acceptInvite`). Nothing else in the API
 * writes the admin role, so an uninvited number has no way in.
 */
@Injectable()
export class AdminTeamService {
  private readonly logger = new Logger(AdminTeamService.name);

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(AdminInvite.name) private readonly inviteModel: Model<AdminInviteDocument>,
  ) {}

  /** Current admins and the invites still waiting to be used. */
  async getTeam(
    actorId: string,
  ): Promise<{ admins: AdminMemberView[]; invites: AdminInviteView[] }> {
    const [admins, invites] = await Promise.all([
      this.userModel.find({ roles: Role.ADMIN }).sort({ createdAt: 1 }).lean().exec(),
      this.inviteModel
        .find({ status: AdminInviteStatus.PENDING })
        .sort({ createdAt: -1 })
        .populate<{ invitedBy: { name?: string } | null }>('invitedBy', 'name')
        .lean()
        .exec(),
    ]);

    return {
      admins: admins.map((u) => ({
        id: String(u._id),
        name: u.name || 'Unnamed admin',
        phone: u.phone ?? '',
        since: (u as { createdAt?: Date }).createdAt ?? null,
        isYou: String(u._id) === actorId,
      })),
      invites: invites.map((i) => ({
        id: String(i._id),
        name: i.name,
        phone: i.phone,
        invitedBy: i.invitedBy ? i.invitedBy.name || 'An admin' : 'Setup script',
        createdAt: (i as { createdAt?: Date }).createdAt ?? null,
      })),
    };
  }

  async invite(actorId: string, dto: InviteAdminDto): Promise<AdminInviteView> {
    const phone = dto.mobile;
    const existing = await this.userModel.findOne({ phone }).lean().exec();
    if (existing?.roles?.includes(Role.ADMIN)) {
      throw new ConflictException('This number already belongs to an admin.');
    }
    const pending = await this.inviteModel
      .exists({ phone, status: AdminInviteStatus.PENDING })
      .exec();
    if (pending) throw new ConflictException('This number already has a pending invite.');

    const invite = await this.inviteModel.create({
      phone,
      name: dto.name.trim(),
      invitedBy: new Types.ObjectId(actorId),
    });
    this.logger.log(`Admin ${actorId} invited ${this.mask(phone)} to the console`);
    return {
      id: String(invite._id),
      name: invite.name,
      phone: invite.phone,
      invitedBy: 'You',
      createdAt: (invite as { createdAt?: Date }).createdAt ?? null,
    };
  }

  async revokeInvite(actorId: string, inviteId: string): Promise<void> {
    if (!Types.ObjectId.isValid(inviteId)) throw new NotFoundException('Invite not found');
    const invite = await this.inviteModel
      .findOneAndUpdate(
        { _id: inviteId, status: AdminInviteStatus.PENDING },
        { status: AdminInviteStatus.REVOKED },
      )
      .exec();
    if (!invite) throw new NotFoundException('Invite not found or already used');
    this.logger.log(`Admin ${actorId} revoked the invite for ${this.mask(invite.phone)}`);
  }

  /**
   * Takes the admin role away. Not from yourself — and never the last admin,
   * which would lock everyone out of the console for good. Their refresh token
   * is dropped too, so the session ends when the current access token expires.
   */
  async removeAdmin(actorId: string, userId: string): Promise<void> {
    if (userId === actorId)
      throw new BadRequestException('You can’t remove your own admin access.');
    if (!Types.ObjectId.isValid(userId)) throw new NotFoundException('Admin not found');
    const user = await this.userModel.findById(userId).exec();
    if (!user || !user.roles.includes(Role.ADMIN)) throw new NotFoundException('Admin not found');

    const admins = await this.userModel.countDocuments({ roles: Role.ADMIN }).exec();
    if (admins <= 1) throw new ForbiddenException('The console needs at least one admin.');

    await this.userModel
      .updateOne({ _id: userId }, { $pull: { roles: Role.ADMIN }, $unset: { refreshTokenHash: 1 } })
      .exec();
    this.logger.log(`Admin ${actorId} removed admin access from ${userId}`);
  }

  /** True when this number has an invite waiting — the sign-up's gate. */
  async hasPendingInvite(phone: string): Promise<boolean> {
    return (
      (await this.inviteModel.exists({ phone, status: AdminInviteStatus.PENDING }).exec()) != null
    );
  }

  /**
   * Called once the invited number has passed its OTP: grants the role, fills
   * in the name the inviter gave if the account has none, and closes the
   * invite. Atomic on the invite, so one invite admits one account.
   */
  async acceptInvite(user: UserDocument): Promise<void> {
    const invite = await this.inviteModel
      .findOneAndUpdate(
        { phone: user.phone, status: AdminInviteStatus.PENDING },
        { status: AdminInviteStatus.ACCEPTED, acceptedUser: user._id, acceptedAt: new Date() },
        { new: true },
      )
      .exec();
    if (!invite) throw new ForbiddenException('This number hasn’t been invited to Evently Admin.');

    if (!user.roles.includes(Role.ADMIN)) user.roles.push(Role.ADMIN);
    if (!user.name) user.name = invite.name;
    await user.save();
    this.logger.log(`Invite for ${this.mask(invite.phone)} accepted by ${String(user._id)}`);
  }

  private mask(phone: string): string {
    return `••••••${phone.slice(-4)}`;
  }
}
