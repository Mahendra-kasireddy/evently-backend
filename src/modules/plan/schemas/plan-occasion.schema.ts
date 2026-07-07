import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { idJsonTransform } from '../../../common/utils/id-transform';
import { HydratedDocument } from 'mongoose';

export type PlanOccasionDocument = HydratedDocument<PlanOccasion>;

/**
 * A selectable occasion in the Plan Event wizard (Wedding, Birthday, …).
 * Normalized out of the `customer-plan` content blob so occasions can be
 * managed as data without a deploy.
 */
@Schema({
  timestamps: true,
  collection: 'plan_occasions',
  toJSON: idJsonTransform(),
})
export class PlanOccasion {
  // Stable slug used by the frontend (e.g. "wedding"). Doubles as natural key.
  @Prop({ required: true, unique: true, trim: true, index: true })
  key: string;

  @Prop({ required: true, trim: true })
  label: string;

  // Art key that maps to the card gradient/illustration on the client.
  @Prop({ required: true, trim: true })
  art: string;

  @Prop({ default: 0, index: true })
  order: number;

  @Prop({ default: true, index: true })
  active: boolean;
}

export const PlanOccasionSchema = SchemaFactory.createForClass(PlanOccasion);
