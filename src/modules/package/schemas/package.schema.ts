import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { idJsonTransform } from '../../../common/utils/id-transform';
import { HydratedDocument } from 'mongoose';

export type PackageDocument = HydratedDocument<Package>;

/** Visual art key — mirrors the frontend OccasionArt union. */
export enum PackageArt {
  WEDDING = 'wedding',
  BIRTHDAY = 'birthday',
  HOUSEWARMING = 'housewarming',
  NAMING = 'naming',
  ANNIVERSARY = 'anniversary',
  CORPORATE = 'corporate',
}

@Schema({
  timestamps: true,
  collection: 'packages',
  toJSON: idJsonTransform(),
})
export class Package {
  @Prop({ trim: true, default: '' })
  badge: string;

  @Prop({ required: true, trim: true })
  title: string;

  // Display string e.g. "120–200 guests"
  @Prop({ trim: true, default: '' })
  guests: string;

  // Display string e.g. "₹2L – 3L"
  @Prop({ trim: true, default: '' })
  budget: string;

  @Prop({ type: [String], default: [] })
  tags: string[];

  @Prop({ type: String, enum: PackageArt, default: PackageArt.WEDDING })
  art: PackageArt;

  // Carousel ordering (lower shows first).
  @Prop({ default: 0, index: true })
  order: number;

  @Prop({ default: true, index: true })
  active: boolean;
}

export const PackageSchema = SchemaFactory.createForClass(Package);
