import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { idJsonTransform } from '../../../common/utils/id-transform';
import { HydratedDocument, Types } from 'mongoose';

export type EventDocument = HydratedDocument<Event>;

export enum EventStatus {
  DRAFT = 'draft',
  PUBLISHED = 'published',
  CANCELLED = 'cancelled',
  COMPLETED = 'completed',
}

@Schema({
  timestamps: true,
  collection: 'events',
  toJSON: idJsonTransform(),
})
export class Event {
  @Prop({ required: true, trim: true, index: true })
  title: string;

  @Prop({ trim: true, default: '' })
  description: string;

  @Prop({ trim: true })
  category: string;

  @Prop({ trim: true })
  venue: string;

  @Prop({ required: true })
  startAt: Date;

  @Prop({ required: true })
  endAt: Date;

  @Prop({ required: true, min: 0 })
  capacity: number;

  @Prop({ required: true, min: 0, default: 0 })
  price: number;

  @Prop({ type: String, enum: EventStatus, default: EventStatus.DRAFT, index: true })
  status: EventStatus;

  // The organizer who owns this event.
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  organizer: Types.ObjectId;
}

export const EventSchema = SchemaFactory.createForClass(Event);

// Common access pattern: list an organizer's events by recency.
EventSchema.index({ organizer: 1, createdAt: -1 });
