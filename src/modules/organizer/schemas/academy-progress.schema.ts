import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { idJsonTransform } from '../../../common/utils/id-transform';
import { HydratedDocument, Types } from 'mongoose';

export type AcademyProgressDocument = HydratedDocument<AcademyProgress>;

@Schema({
  timestamps: true,
  collection: 'academy_progress',
  toJSON: idJsonTransform(),
})
export class AcademyProgress {
  @Prop({
    type: Types.ObjectId,
    ref: 'OrganizerProfile',
    required: true,
    unique: true,
    index: true,
  })
  organizer: Types.ObjectId;

  @Prop({ type: [String], default: [] })
  completedLessons: string[];

  @Prop({ type: [String], default: [] })
  registeredWorkshops: string[];

  @Prop({ type: [String], default: [] })
  completedStage3: string[];

  createdAt?: Date;
  updatedAt?: Date;
}

export const AcademyProgressSchema = SchemaFactory.createForClass(AcademyProgress);
