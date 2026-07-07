import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { idJsonTransform } from '../../../common/utils/id-transform';
import { HydratedDocument } from 'mongoose';

export type PlanGuestRangeDocument = HydratedDocument<PlanGuestRange>;

/**
 * A selectable guest-count option (e.g. "50", "100", "500+"). Kept as a display
 * value because the wizard offers coarse buckets, not exact counts.
 */
@Schema({
  timestamps: true,
  collection: 'plan_guest_ranges',
  toJSON: idJsonTransform(),
})
export class PlanGuestRange {
  // Display value shown in the dropdown; also the natural key (e.g. "500+").
  @Prop({ required: true, unique: true, trim: true, index: true })
  value: string;

  @Prop({ default: 0, index: true })
  order: number;

  @Prop({ default: true, index: true })
  active: boolean;
}

export const PlanGuestRangeSchema = SchemaFactory.createForClass(PlanGuestRange);
