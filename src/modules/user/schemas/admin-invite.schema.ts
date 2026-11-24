import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { idJsonTransform } from '../../../common/utils/id-transform';

export type AdminInviteDocument = HydratedDocument<AdminInvite>;

export enum AdminInviteStatus {
  PENDING = 'pending',
  ACCEPTED = 'accepted',
  REVOKED = 'revoked',
}

/**
 * An existing admin's invitation for one mobile number to join the console.
 *
 * The only way the admin role is granted: the invited person signs up on the
 * console, proves the number with an OTP, and the pending invite for that
 * number is what lets them in. Kept after it is used or revoked, as the record
 * of who brought whom in.
 */
@Schema({ timestamps: true, collection: 'admin_invites', toJSON: idJsonTransform() })
export class AdminInvite {
  /** 10 digits, no dial code — the same form `users.phone` is stored in. */
  @Prop({ required: true, trim: true, index: true })
  phone: string;

  @Prop({ required: true, trim: true, maxlength: 80 })
  name: string;

  @Prop({ type: String, enum: AdminInviteStatus, default: AdminInviteStatus.PENDING, index: true })
  status: AdminInviteStatus;

  /** Empty only for the first admin, invited by `npm run invite:admin`. */
  @Prop({ type: Types.ObjectId, ref: 'User' })
  invitedBy?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  acceptedUser?: Types.ObjectId;

  @Prop({ type: Date })
  acceptedAt?: Date;
}

export const AdminInviteSchema = SchemaFactory.createForClass(AdminInvite);

// At most one pending invite per number.
AdminInviteSchema.index(
  { phone: 1 },
  { unique: true, partialFilterExpression: { status: AdminInviteStatus.PENDING } },
);
