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
  /**
   * A trade Evently does not have a category for yet. The vendor's own words
   * live in `customCategory`; this stays a real enum member so organizer
   * vendor-matching, the rate-card unit and the admin roster filters all keep
   * working instead of being handed an unknown string.
   */
  OTHER = 'other',
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

  /**
   * What the vendor called their trade, when `category` is OTHER. Empty for
   * every other category, so it can never disagree with the enum.
   */
  @Prop({ trim: true, default: '', maxlength: 60 })
  customCategory: string;

  /**
   * Cleared once an admin has dealt with the suggestion — either by adding a
   * real category or deciding not to. Until then the request sits in the admin
   * console, so a vendor asking for a category nobody can filter by is
   * visible rather than silently unmatchable.
   */
  @Prop({ default: false, index: true })
  customCategoryResolved: boolean;

  @Prop({ default: true, index: true })
  active: boolean;

  createdAt?: Date;
  updatedAt?: Date;
}

export const SubVendorProfileSchema = SchemaFactory.createForClass(SubVendorProfile);
