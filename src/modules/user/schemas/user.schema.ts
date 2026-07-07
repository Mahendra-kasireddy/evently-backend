import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { idJsonTransform } from '../../../common/utils/id-transform';
import { HydratedDocument } from 'mongoose';
import { Role } from '../../../common/enums/role.enum';

export type UserDocument = HydratedDocument<User>;

export enum UserStatus {
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
}

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
}

export const UserSchema = SchemaFactory.createForClass(User);
