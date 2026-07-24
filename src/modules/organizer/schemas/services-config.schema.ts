import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { idJsonTransform } from '../../../common/utils/id-transform';
import { HydratedDocument } from 'mongoose';

/**
 * Simple key/label reference collections backing the Step 4 (Services) dropdowns.
 * All share the same {key,label,order,active} shape but live in their own
 * collections so each can be curated independently. Nothing is hardcoded on the
 * client — these are seeded and served via GET /organizer/services-config.
 */

@Schema({ timestamps: true, collection: 'experience_ranges', toJSON: idJsonTransform() })
export class ExperienceRange {
  @Prop({ required: true, unique: true, trim: true, index: true })
  key: string;
  @Prop({ required: true, trim: true })
  label: string;
  @Prop({ default: 0, index: true })
  order: number;
  @Prop({ default: true, index: true })
  active: boolean;
}
export type ExperienceRangeDocument = HydratedDocument<ExperienceRange>;
export const ExperienceRangeSchema = SchemaFactory.createForClass(ExperienceRange);

@Schema({ timestamps: true, collection: 'team_sizes', toJSON: idJsonTransform() })
export class TeamSize {
  @Prop({ required: true, unique: true, trim: true, index: true })
  key: string;
  @Prop({ required: true, trim: true })
  label: string;
  @Prop({ default: 0, index: true })
  order: number;
  @Prop({ default: true, index: true })
  active: boolean;
}
export type TeamSizeDocument = HydratedDocument<TeamSize>;
export const TeamSizeSchema = SchemaFactory.createForClass(TeamSize);

@Schema({ timestamps: true, collection: 'languages', toJSON: idJsonTransform() })
export class Language {
  @Prop({ required: true, unique: true, trim: true, index: true })
  key: string;
  @Prop({ required: true, trim: true })
  label: string;
  @Prop({ default: 0, index: true })
  order: number;
  @Prop({ default: true, index: true })
  active: boolean;
}
export type LanguageDocument = HydratedDocument<Language>;
export const LanguageSchema = SchemaFactory.createForClass(Language);

@Schema({ timestamps: true, collection: 'travel_options', toJSON: idJsonTransform() })
export class TravelOption {
  @Prop({ required: true, unique: true, trim: true, index: true })
  key: string;
  @Prop({ required: true, trim: true })
  label: string;
  @Prop({ default: 0, index: true })
  order: number;
  @Prop({ default: true, index: true })
  active: boolean;
}
export type TravelOptionDocument = HydratedDocument<TravelOption>;
export const TravelOptionSchema = SchemaFactory.createForClass(TravelOption);

@Schema({ timestamps: true, collection: 'payment_methods', toJSON: idJsonTransform() })
export class PaymentMethod {
  @Prop({ required: true, unique: true, trim: true, index: true })
  key: string;
  @Prop({ required: true, trim: true })
  label: string;
  @Prop({ default: 0, index: true })
  order: number;
  @Prop({ default: true, index: true })
  active: boolean;
}
export type PaymentMethodDocument = HydratedDocument<PaymentMethod>;
export const PaymentMethodSchema = SchemaFactory.createForClass(PaymentMethod);

@Schema({ timestamps: true, collection: 'working_days', toJSON: idJsonTransform() })
export class WorkingDay {
  @Prop({ required: true, unique: true, trim: true, index: true })
  key: string;
  @Prop({ required: true, trim: true })
  label: string;
  @Prop({ default: 0, index: true })
  order: number;
  @Prop({ default: true, index: true })
  active: boolean;
}
export type WorkingDayDocument = HydratedDocument<WorkingDay>;
export const WorkingDaySchema = SchemaFactory.createForClass(WorkingDay);

/** Also used for document_types (Step 2 government ID type dropdown). */
@Schema({ timestamps: true, collection: 'document_types', toJSON: idJsonTransform() })
export class DocumentType {
  @Prop({ required: true, unique: true, trim: true, index: true })
  key: string;
  @Prop({ required: true, trim: true })
  label: string;
  @Prop({ default: 0, index: true })
  order: number;
  @Prop({ default: true, index: true })
  active: boolean;
}
export type DocumentTypeDocument = HydratedDocument<DocumentType>;
export const DocumentTypeSchema = SchemaFactory.createForClass(DocumentType);
