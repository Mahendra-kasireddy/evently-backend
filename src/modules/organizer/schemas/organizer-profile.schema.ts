import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { idJsonTransform } from '../../../common/utils/id-transform';
import { HydratedDocument, Types } from 'mongoose';

export type OrganizerProfileDocument = HydratedDocument<OrganizerProfile>;

export enum OrganizerTier {
  SILVER = 'Silver',
  GOLD = 'Gold',
  PLATINUM = 'Platinum',
}

@Schema({
  timestamps: true,
  collection: 'organizer_profiles',
  toJSON: idJsonTransform(),
})
export class OrganizerProfile {
  // Optional link to the owning user account (role = organizer).
  @Prop({ type: Types.ObjectId, ref: 'User', index: true })
  user?: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name: string;

  // 2-letter monogram shown on the avatar, e.g. "SE".
  @Prop({ trim: true, default: '' })
  initials: string;

  @Prop({ trim: true, default: '#7c5bd6' })
  avatarColor: string;

  @Prop({ type: String, enum: OrganizerTier, default: OrganizerTier.SILVER })
  tier: OrganizerTier;

  @Prop({ default: 0, min: 0, max: 5 })
  rating: number;

  @Prop({ default: 0, min: 0 })
  reviews: number;

  // Number of events delivered.
  @Prop({ default: 0, min: 0 })
  events: number;

  @Prop({ type: [String], default: [] })
  tags: string[];

  // Service area shown on the plan cards, e.g. "Banjara Hills".
  @Prop({ trim: true, default: '' })
  location: string;

  // Rough quote estimate range, e.g. "₹2.4L – 3.2L".
  @Prop({ trim: true, default: '' })
  estRange: string;

  // Home ranking weight (higher shows first) + active flag.
  @Prop({ default: 0, index: true })
  rank: number;

  @Prop({ default: true, index: true })
  active: boolean;
}

export const OrganizerProfileSchema = SchemaFactory.createForClass(OrganizerProfile);
