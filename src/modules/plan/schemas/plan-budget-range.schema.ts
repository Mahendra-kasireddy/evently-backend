import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { idJsonTransform } from '../../../common/utils/id-transform';
import { HydratedDocument } from 'mongoose';

export type PlanBudgetRangeDocument = HydratedDocument<PlanBudgetRange>;

/**
 * A selectable budget bucket for the wizard (e.g. "Under ₹1L", "₹1L – 3L").
 * Optional for the customer, but when picked it is stored on the plan and
 * passed to the recommendation engine as a soft signal. Configurable in Mongo
 * so ranges can be tuned without a deploy.
 */
@Schema({
  timestamps: true,
  collection: 'plan_budget_ranges',
  toJSON: idJsonTransform(),
})
export class PlanBudgetRange {
  // Display value shown as a chip; also the natural key (e.g. "₹1L – 3L").
  @Prop({ required: true, unique: true, trim: true, index: true })
  value: string;

  @Prop({ default: 0, index: true })
  order: number;

  @Prop({ default: true, index: true })
  active: boolean;
}

export const PlanBudgetRangeSchema = SchemaFactory.createForClass(PlanBudgetRange);
