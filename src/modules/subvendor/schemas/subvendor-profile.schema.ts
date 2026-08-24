import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { idJsonTransform } from '../../../common/utils/id-transform';
import { HydratedDocument, Types } from 'mongoose';

export type SubVendorProfileDocument = HydratedDocument<SubVendorProfile>;

/** Matches the frontend's VENDOR_CATEGORIES ids (onboarding/subvendor/constants.ts). */
export enum SubVendorCategory {
  FOOD = 'food',
  WATER = 'water',
  DECOR = 'decor',
  PHOTOGRAPHY = 'photography',
  MUSIC = 'music',
  TRANSPORT = 'transport',
  PRIEST = 'priest',
  MEHENDI = 'mehendi',
}

@Schema({
  timestamps: true,
  collection: 'subvendor_profiles',
  toJSON: idJsonTransform(),
})
export class SubVendorProfile {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, unique: true, index: true })
  user: Types.ObjectId;

  @Prop({ required: true, trim: true })
  fullName: string;

  @Prop({ trim: true, default: '' })
  initials: string;

  @Prop({ trim: true, default: '#1d9e75' })
  avatarColor: string;

  @Prop({ type: String, enum: SubVendorCategory, required: true })
  category: SubVendorCategory;

  @Prop({ trim: true, default: '' })
  serviceArea: string;

  @Prop({ default: 0, min: 0 })
  baseRate: number;

  /** e.g. "bottle", "plate" — echoes the category's unit at signup time. */
  @Prop({ trim: true, default: '' })
  baseRateUnit: string;

  @Prop({ default: 0, min: 0 })
  minOrder: number;

  @Prop({ default: true, index: true })
  active: boolean;

  createdAt?: Date;
  updatedAt?: Date;
}

export const SubVendorProfileSchema = SchemaFactory.createForClass(SubVendorProfile);
