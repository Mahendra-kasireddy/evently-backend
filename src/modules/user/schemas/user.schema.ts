import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { idJsonTransform } from '../../../common/utils/id-transform';
import { HydratedDocument, Types } from 'mongoose';
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

/**
 * Which side of the product an account opens on.
 *
 * An explicit choice (registering a business, or switching from a profile)
 * wins while the account still holds that role. With no choice on record —
 * every account created before the field existed, and every new customer —
 * a business role wins over customer: someone who runs a business on Evently
 * signs in to run it. A plain customer has nothing else to open.
 */
export function resolveDefaultRole(roles: readonly string[] = [], stored?: string | null): Role {
  if (stored && roles.includes(stored)) return stored as Role;
  if (roles.includes(Role.ORGANIZER)) return Role.ORGANIZER;
  if (roles.includes(Role.VENDOR)) return Role.VENDOR;
  return Role.CUSTOMER;
}

const baseUserJson = idJsonTransform('passwordHash', 'refreshTokenHash');

@Schema({
  timestamps: true,
  toJSON: {
    ...baseUserJson,
    // Clients always receive the resolved default, never a missing one.
    transform: (doc: unknown, ret: Record<string, unknown>) => {
      baseUserJson.transform(doc, ret);
      ret.defaultRole = resolveDefaultRole(
        ret.roles as string[] | undefined,
        ret.defaultRole as string | undefined,
      );
      return ret;
    },
  },
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

  /**
   * The account holder's photo, as uploaded through `/upload` (purpose
   * `profileImage`). Asked for with the name on first sign-in. Only ever an
   * Evently-hosted file — see PROFILE_PHOTO_URL in the profile DTO.
   */
  @Prop({ trim: true, default: '' })
  photoUrl: string;

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

  /**
   * The side of the product the account holder chose to open on, if they
   * have chosen. One login screen serves every role, and an organizer keeps
   * their customer role too, so the role list alone cannot say where to land.
   * Unset means "no choice yet" — read it through `resolveDefaultRole`, which
   * the JSON output already does. Only ever a role the account holds:
   * `UserService.setDefaultRole` refuses anything else.
   */
  @Prop({
    type: String,
    enum: [Role.CUSTOMER, Role.ORGANIZER, Role.VENDOR],
    default: undefined,
  })
  defaultRole?: Role;

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

  /**
   * Curated packages the customer has kept for later.
   *
   * References rather than copies: a package's price band, guest range and
   * tags are edited in the admin, and a saved snapshot would go stale the
   * first time one changed — the customer would be looking at an offer that no
   * longer exists. A package deleted outright simply drops out of the list
   * when it is populated, which is the honest outcome.
   *
   * An array on the user rather than its own collection because this list is
   * short by nature, is only ever read for one account at a time, and is
   * written by exactly two operations.
   */
  @Prop({ type: [{ type: Types.ObjectId, ref: 'Package' }], default: [] })
  savedPackages: Types.ObjectId[];
}

export const UserSchema = SchemaFactory.createForClass(User);
