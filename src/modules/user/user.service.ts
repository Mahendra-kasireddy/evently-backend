import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcryptjs';

import { NotificationPrefs, User, UserDocument, UserStatus } from './schemas/user.schema';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';
import { Role } from '../../common/enums/role.enum';

const BCRYPT_ROUNDS = 12;

@Injectable()
export class UserService {
  constructor(@InjectModel(User.name) private readonly userModel: Model<UserDocument>) {}

  async create(dto: CreateUserDto): Promise<UserDocument> {
    const existing = await this.userModel.exists({ email: dto.email.toLowerCase() });
    if (existing) {
      throw new ConflictException('Email already registered');
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const user = new this.userModel({
      name: dto.name,
      email: dto.email,
      passwordHash,
      roles: dto.roles?.length ? dto.roles : undefined,
    });
    return user.save();
  }

  /** Includes passwordHash (normally select:false) — for auth validation only. */
  findByEmailWithSecret(email: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ email: email.toLowerCase() }).select('+passwordHash').exec();
  }

  async findById(id: string): Promise<UserDocument> {
    this.assertObjectId(id);
    const user = await this.userModel.findById(id).exec();
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  /**
   * The customer's notification choices. Defaults are applied for a document
   * written before the field existed, so a legacy account is opted in to the
   * two it would expect and out of marketing.
   */
  async getNotificationPrefs(
    userId: string,
  ): Promise<{ quotes: boolean; invitations: boolean; marketing: boolean }> {
    const user = await this.findById(userId);
    const prefs = user.notificationPrefs ?? ({} as Partial<NotificationPrefs>);
    return {
      quotes: prefs.quotes !== false,
      invitations: prefs.invitations !== false,
      marketing: prefs.marketing === true,
    };
  }

  /** Updates only the flags supplied; the rest keep their current value. */
  async updateNotificationPrefs(userId: string, dto: UpdatePreferencesDto): Promise<UserDocument> {
    const current = await this.getNotificationPrefs(userId);
    const next = {
      quotes: dto.quotes ?? current.quotes,
      invitations: dto.invitations ?? current.invitations,
      marketing: dto.marketing ?? current.marketing,
    };
    const updated = await this.userModel
      .findByIdAndUpdate(userId, { notificationPrefs: next }, { new: true })
      .exec();
    if (!updated) throw new NotFoundException('User not found');
    return updated;
  }

  /**
   * Closes the account at its holder's request.
   *
   * A soft close, not a row delete: bookings, payments and messages reference
   * this user, and removing it would leave an organizer's paid booking
   * pointing at nothing. The session is revoked here, and `assertActive`
   * refuses to issue another — so the account is unreachable from this moment
   * even though the record survives for the events that depend on it.
   */
  async closeOwnAccount(userId: string): Promise<{ closed: true }> {
    const user = await this.findById(userId);
    if (user.status === UserStatus.DELETED) return { closed: true };

    await this.userModel
      .findByIdAndUpdate(userId, {
        status: UserStatus.DELETED,
        deletedAt: new Date(),
        refreshTokenHash: null,
      })
      .exec();
    return { closed: true };
  }

  /** Compact profile for the home header/greeting: name, initials, location. */
  async getProfileSummary(
    id: string,
  ): Promise<{ id: string; name: string; initials: string; location: string }> {
    const user = await this.findById(id);
    return {
      id: user._id.toString(),
      name: user.name || 'there',
      initials: this.initialsOf(user.name),
      location: user.city || '',
    };
  }

  private initialsOf(name?: string): string {
    if (!name) return 'U';
    const parts = name.trim().split(/\s+/).filter(Boolean);
    const letters = parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '');
    return letters.join('') || 'U';
  }

  async update(id: string, dto: UpdateUserDto): Promise<UserDocument> {
    this.assertObjectId(id);
    const user = await this.userModel.findByIdAndUpdate(id, dto, { new: true }).exec();
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  /**
   * Idempotently adds a role to a user (multi-role supported). Returns the
   * updated user. Used to upgrade an existing customer to also be an organizer
   * without creating a duplicate account.
   */
  async addRole(id: string, role: Role): Promise<UserDocument> {
    this.assertObjectId(id);
    const user = await this.userModel
      .findByIdAndUpdate(id, { $addToSet: { roles: role } }, { new: true })
      .exec();
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  // ----- refresh-token lifecycle (used by AuthService) -----

  async setRefreshTokenHash(userId: string, token: string | null): Promise<void> {
    const refreshTokenHash = token ? await bcrypt.hash(token, BCRYPT_ROUNDS) : null;
    await this.userModel.findByIdAndUpdate(userId, { refreshTokenHash }).exec();
  }

  /** Loads a user with the stored refresh-token hash for rotation checks. */
  findByIdWithRefreshHash(userId: string): Promise<UserDocument | null> {
    if (!Types.ObjectId.isValid(userId)) return Promise.resolve(null);
    return this.userModel.findById(userId).select('+refreshTokenHash').exec();
  }

  // ----- phone / OTP users -----

  findByPhone(phone: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ phone }).exec();
  }

  /**
   * Find a user by phone, or create a new customer (passwordless OTP signup).
   * Returns isNew so the caller can route first-time users to onboarding.
   */
  async findOrCreateByPhone(phone: string): Promise<{ user: UserDocument; isNew: boolean }> {
    const existing = await this.userModel.findOne({ phone }).exec();
    if (existing) {
      if (!existing.phoneVerified) {
        existing.phoneVerified = true;
        await existing.save();
      }
      return { user: existing, isNew: false };
    }
    const user = await this.userModel.create({
      phone,
      phoneVerified: true,
      roles: [Role.CUSTOMER],
    });
    return { user, isNew: true };
  }

  private assertObjectId(id: string): void {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('User not found');
    }
  }
}
