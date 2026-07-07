import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { idJsonTransform } from '../../../common/utils/id-transform';
import { HydratedDocument } from 'mongoose';

export type PlanCityDocument = HydratedDocument<PlanCity>;

/** A city option offered in the Plan Event "event details" step. */
@Schema({
  timestamps: true,
  collection: 'plan_cities',
  toJSON: idJsonTransform(),
})
export class PlanCity {
  // City name; also the natural key (e.g. "Hyderabad").
  @Prop({ required: true, unique: true, trim: true, index: true })
  name: string;

  @Prop({ default: 0, index: true })
  order: number;

  @Prop({ default: true, index: true })
  active: boolean;
}

export const PlanCitySchema = SchemaFactory.createForClass(PlanCity);
