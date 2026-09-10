import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { idJsonTransform } from '../../../common/utils/id-transform';
import { HydratedDocument, Types } from 'mongoose';
import { StoredFileSchema, StoredFile } from '../../organizer/schemas/organizer-profile.schema';

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

  // -------------------------------------------------------------------------
  // What a package card shows beyond its own copy.
  //
  // The organizer is a reference, not a copy: a card claims a rating and a
  // review count, and those change. Reading them through the link means the
  // card can never quote a score the organizer no longer has.
  // -------------------------------------------------------------------------

  /** Who actually delivers this. Null for a package not yet assigned to one. */
  @Prop({ type: Types.ObjectId, ref: 'OrganizerProfile', default: null, index: true })
  organizer: Types.ObjectId | null;

  /** The fixed price, in rupees. 0 while only the `budget` band is known. */
  @Prop({ default: 0, min: 0 })
  price: number;

  /**
   * What it used to cost, when this is genuinely a reduction.
   *
   * 0 means there is no discount, and the card then shows no struck-through
   * figure at all — an invented "original" beside a price is a claim about
   * money, and the one thing it must never be is decorative.
   */
  @Prop({ default: 0, min: 0 })
  listPrice: number;

  /** The card's banner photo. Null falls back to the occasion illustration. */
  @Prop({ type: StoredFileSchema, default: null })
  photo?: StoredFile | null;

  /** A short line over the banner, e.g. "Marigold stage · 150 guests". */
  @Prop({ trim: true, default: '' })
  bannerNote: string;
}

export const PackageSchema = SchemaFactory.createForClass(Package);
