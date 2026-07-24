import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { idJsonTransform } from '../../../common/utils/id-transform';
import { HydratedDocument } from 'mongoose';

export type BusinessTypeDocument = HydratedDocument<BusinessType>;

/** Legal/business structure option shown in organizer onboarding (Step 1). */
@Schema({
  timestamps: true,
  collection: 'business_types',
  toJSON: idJsonTransform(),
})
export class BusinessType {
  // Stable slug used as the natural key and stored on the profile, e.g. "private_limited".
  @Prop({ required: true, unique: true, trim: true, index: true })
  key: string;

  @Prop({ required: true, trim: true })
  label: string;

  @Prop({ default: 0, index: true })
  order: number;

  @Prop({ default: true, index: true })
  active: boolean;
}

export const BusinessTypeSchema = SchemaFactory.createForClass(BusinessType);
