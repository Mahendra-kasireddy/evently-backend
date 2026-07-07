import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type OtpDocument = HydratedDocument<Otp>;

export enum OtpPurpose {
  LOGIN = 'login',
}

@Schema({ timestamps: true, collection: 'otps' })
export class Otp {
  @Prop({ required: true, index: true })
  phone: string;

  // Only the hash of the code is stored — never the plaintext OTP.
  @Prop({ required: true, select: false })
  codeHash: string;

  @Prop({ type: String, enum: OtpPurpose, default: OtpPurpose.LOGIN })
  purpose: OtpPurpose;

  @Prop({ default: 0 })
  attempts: number;

  @Prop({ default: false })
  consumed: boolean;

  // TTL anchor — Mongo deletes the document once this time passes.
  @Prop({ required: true })
  expiresAt: Date;
}

export const OtpSchema = SchemaFactory.createForClass(Otp);

// TTL index: remove expired OTP docs automatically.
OtpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
