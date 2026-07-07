import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { idJsonTransform } from '../../../common/utils/id-transform';
import { HydratedDocument } from 'mongoose';

export type PlanServiceCategoryDocument = HydratedDocument<PlanServiceCategory>;

/**
 * A service the customer can request on the "categories" step (Food, Decoration,
 * Photography, …). The `key` is used both by the client and by the recommendation
 * scorer to match organizer service tags.
 */
@Schema({
  timestamps: true,
  collection: 'plan_service_categories',
  toJSON: idJsonTransform(),
})
export class PlanServiceCategory {
  // Stable slug (e.g. "photography"). Natural key.
  @Prop({ required: true, unique: true, trim: true, index: true })
  key: string;

  @Prop({ required: true, trim: true })
  title: string;

  @Prop({ trim: true, default: '' })
  subtitle: string;

  // Icon key resolved to a Lucide icon on the client.
  @Prop({ required: true, trim: true })
  icon: string;

  // Keywords used to test an organizer's service tags when scoring matches.
  @Prop({ type: [String], default: [] })
  keywords: string[];

  @Prop({ default: 0, index: true })
  order: number;

  @Prop({ default: true, index: true })
  active: boolean;
}

export const PlanServiceCategorySchema = SchemaFactory.createForClass(PlanServiceCategory);
