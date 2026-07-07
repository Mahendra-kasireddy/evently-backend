import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { idJsonTransform } from '../../../common/utils/id-transform';
import { HydratedDocument, Types } from 'mongoose';

export type BookingDocument = HydratedDocument<Booking>;

export enum BookingStatus {
  ACTIVE = 'active',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}

@Schema({
  timestamps: true,
  collection: 'bookings',
  toJSON: idJsonTransform(),
})
export class Booking {
  // Owning customer — every booking belongs to one user.
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  customer: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'OrganizerProfile' })
  organizer?: Types.ObjectId;

  // Human-facing reference, e.g. "EVT-2026-8841".
  @Prop({ required: true, trim: true })
  ref: string;

  @Prop({ required: true, trim: true })
  title: string;

  @Prop({ trim: true, default: '' })
  description: string;

  // The event date — daysToGo is derived from this at read time.
  @Prop({ required: true })
  eventDate: Date;

  @Prop({ default: 0, min: 0, max: 100 })
  progress: number;

  // Checklist shown on the card.
  @Prop({ type: [{ label: String, done: Boolean, _id: false }], default: [] })
  steps: { label: string; done: boolean }[];

  @Prop({ type: String, enum: BookingStatus, default: BookingStatus.ACTIVE, index: true })
  status: BookingStatus;
}

export const BookingSchema = SchemaFactory.createForClass(Booking);

// Fast lookup of a customer's active booking.
BookingSchema.index({ customer: 1, status: 1 });
