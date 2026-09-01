import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { idJsonTransform } from '../../../common/utils/id-transform';
import { HydratedDocument } from 'mongoose';
import { Role } from '../../../common/enums/role.enum';

export type UserDocument = HydratedDocument<User>;

export enum UserStatus {
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  /**
   * The account holder asked for it to be closed. Kept rather than removed:
   * their bookings, payments and messages reference this user, and deleting
   * the row would leave an organizer's paid booking pointing at nothing.
   * `AuthService.assertActive` refuses to issue a session for it.
   */
  DELETED = 'deleted',
}

/**
 * What the customer has chosen to be told about.
 *
 * Checked by NotificationService before a notification is written, so turning
 * one off actually stops it — a stored preference nothing reads is worse than
 * no preference at all. Booking and payment notices are deliberately absent:
 * they are the record of money moving and a commitment made, which is not a
 * marketing choice.
 */
@Schema({ _id: false })
export class NotificationPrefs {
  /** Quotes arriving from organizers. */
  @Prop({ default: true })
  quotes: boolean;

  /** Invitations shared for the customer's approval. */
  @Prop({ default: true })
  invitations: boolean;

  /** Ideas, tips and offers. Off unless asked for. */
  @Prop({ default: false })
  marketing: boolean;
}

export const NotificationPrefsSchema = SchemaFactory.createForClass(NotificationPrefs);

@Schema({
  timestamps: true,
  toJSON: idJsonTransform('passwordHash', 'refreshTokenHash'),
})
export class User {
  @Prop({ trim: true, default: '' })
  name: string;

  // Primary identifier for passwordless OTP login. Stored as digits, no dial code.
  // sparse + unique: many docs may legitimately have no phone, but any present must be unique.
  @Prop({ unique: true, sparse: true, trim: true, index: true })
  phone?: string;

  @Prop({ unique: true, sparse: true, lowercase: true, trim: true, index: true })
  email?: string;

  @Prop({ default: false })
  phoneVerified: boolean;

  // City/location shown in the header, e.g. "Hyderabad, Telangana".
  @Prop({ trim: true, default: '' })
  city: string;

  // Optional — only set for users who registered with a password (not OTP users).
  @Prop({ select: false })
  passwordHash?: string;

  @Prop({
    type: [String],
    enum: Role,
    default: [Role.CUSTOMER],
  })
  roles: Role[];

  @Prop({ type: String, enum: UserStatus, default: UserStatus.ACTIVE })
  status: UserStatus;

  // Hash of the current refresh token; null once logged out. Never returned to clients.
  @Prop({ type: String, default: null, select: false })
  refreshTokenHash: string | null;

  @Prop({ type: NotificationPrefsSchema, default: () => ({}) })
  notificationPrefs: NotificationPrefs;

  /** When the account holder asked for it to be closed. */
  @Prop({ type: Date, default: null })
  deletedAt?: Date | null;
}

export const UserSchema = SchemaFactory.createForClass(User);
