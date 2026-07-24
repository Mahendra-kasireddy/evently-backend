import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { idJsonTransform } from '../../../common/utils/id-transform';
import { HydratedDocument } from 'mongoose';

export type OrganizerCategoryDocument = HydratedDocument<OrganizerCategory>;

/**
 * The kind of organizer business (primary/secondary category) — distinct from
 * the customer-facing `plan_service_categories` (individual services). Shown in
 * organizer onboarding (Step 1).
 */
@Schema({
  timestamps: true,
  collection: 'organizer_categories',
  toJSON: idJsonTransform(),
})
export class OrganizerCategory {
  // Stable slug used as the natural key and stored on the profile, e.g. "wedding_planner".
  @Prop({ required: true, unique: true, trim: true, index: true })
  key: string;

  @Prop({ required: true, trim: true })
  label: string;

  @Prop({ trim: true, default: '' })
  icon: string;

  @Prop({ default: 0, index: true })
  order: number;

  @Prop({ default: true, index: true })
  active: boolean;
}

export const OrganizerCategorySchema = SchemaFactory.createForClass(OrganizerCategory);
