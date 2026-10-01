import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export enum EventMemoryKind {
  PHOTO = 'photo',
  VIDEO = 'video',
}

/**
 * Where a memory stands.
 *
 * VISIBLE is in the gallery. PENDING waits for the organizer when the event
 * moderates uploads, and is shown only to the person who added it. REJECTED
 * and REMOVED are kept rather than deleted, so a report has a record.
 */
export enum EventMemoryStatus {
  VISIBLE = 'visible',
  PENDING = 'pending',
  REJECTED = 'rejected',
  REMOVED = 'removed',
}

export type EventMemoryDocument = HydratedDocument<EventMemory>;

/** One photo or clip an attendee added to a public event's gallery. */
@Schema({ timestamps: true, collection: 'public_event_memories' })
export class EventMemory {
  @Prop({ type: Types.ObjectId, ref: 'PublicEvent', required: true, index: true })
  event: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  uploader: Types.ObjectId;

  @Prop({ type: String, enum: Object.values(EventMemoryKind), required: true })
  kind: EventMemoryKind;

  @Prop({ required: true, trim: true })
  url: string;

  @Prop({ required: true, trim: true })
  storageKey: string;

  @Prop({ trim: true, default: '', maxlength: 280 })
  caption: string;

  @Prop({
    type: String,
    enum: Object.values(EventMemoryStatus),
    default: EventMemoryStatus.VISIBLE,
    index: true,
  })
  status: EventMemoryStatus;
}

export const EventMemorySchema = SchemaFactory.createForClass(EventMemory);
EventMemorySchema.index({ event: 1, status: 1, createdAt: -1 });
