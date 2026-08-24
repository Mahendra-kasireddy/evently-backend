import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { idJsonTransform } from '../../../common/utils/id-transform';
import { HydratedDocument, Types } from 'mongoose';

export type BookingDocument = HydratedDocument<Booking>;

/** Full booking lifecycle, beginning when a customer accepts a quotation. */
export enum BookingStatus {
  PENDING = 'pending', // created, awaiting organizer confirmation
  CONFIRMED = 'confirmed', // organizer accepted the booking
  IN_PROGRESS = 'in_progress', // event delivery underway
  COMPLETED = 'completed', // event delivered
  CANCELLED = 'cancelled', // cancelled by customer or organizer
  REJECTED = 'rejected', // organizer could not take it
}

/** Statuses considered an ongoing/active booking (drives the home card). */
export const ONGOING_BOOKING_STATUSES = [BookingStatus.CONFIRMED, BookingStatus.IN_PROGRESS];

/** A single status-change entry, powering the booking timeline. */
@Schema({ _id: false })
export class BookingTimelineEntry {
  @Prop({ required: true, trim: true })
  status: string;

  @Prop({ required: true, trim: true })
  label: string;

  @Prop({ trim: true, default: '' })
  note: string;

  @Prop({ type: Date, default: () => new Date() })
  at: Date;
}
export const BookingTimelineEntrySchema = SchemaFactory.createForClass(BookingTimelineEntry);

/** Kanban-style status for an organizer's own execution task on a booking. */
export enum BookingTaskStatus {
  TODO = 'todo',
  IN_PROGRESS = 'in_progress',
  DONE = 'done',
}

/** Whether an assigned sub-vendor has responded to a task assignment yet. */
export enum TaskAssignmentStatus {
  UNASSIGNED = 'unassigned',
  PENDING = 'pending',
  ACCEPTED = 'accepted',
  DECLINED = 'declined',
}

/**
 * An organizer-authored to-do for delivering one booking (e.g. "Confirm
 * 300-plate catering"). Distinct from the fixed lifecycle `steps` checklist
 * above — this is a free-form board the organizer builds per event.
 * `assigneeName` is a denormalized snapshot of the sub-vendor's name at
 * assignment time (or free text, if not assigned to a real sub-vendor) —
 * kept so the task never depends on a cross-module join to render.
 */
@Schema({ _id: true, timestamps: true })
export class BookingTask {
  @Prop({ required: true, trim: true })
  title: string;

  @Prop({ type: String, enum: BookingTaskStatus, default: BookingTaskStatus.TODO })
  status: BookingTaskStatus;

  @Prop({ trim: true, default: '' })
  assigneeName: string;

  @Prop({ type: Types.ObjectId, ref: 'SubVendorProfile' })
  subVendorId?: Types.ObjectId;

  @Prop({
    type: String,
    enum: TaskAssignmentStatus,
    default: TaskAssignmentStatus.UNASSIGNED,
  })
  assignmentStatus: TaskAssignmentStatus;

  // Agreed pay for this task, when assigned to a sub-vendor (rupees).
  @Prop({ default: 0, min: 0 })
  amount: number;

  @Prop({ type: Date })
  dueDate?: Date;

  @Prop({ type: { url: String, key: String, originalName: String }, default: null })
  photoProof: { url: string; key: string; originalName: string } | null;

  createdAt?: Date;
  updatedAt?: Date;
}
export const BookingTaskSchema = SchemaFactory.createForClass(BookingTask);

@Schema({
  timestamps: true,
  collection: 'bookings',
  toJSON: idJsonTransform(),
})
export class Booking {
  // Owning customer — every booking belongs to one user.
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  customer: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'OrganizerProfile', index: true })
  organizer?: Types.ObjectId;

  // Source quotation this booking was created from (idempotency key).
  @Prop({ type: Types.ObjectId, ref: 'Quotation', index: true })
  quotation?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'QuoteRequest' })
  request?: Types.ObjectId;

  // Human-facing reference, e.g. "EVT-2026-8841".
  @Prop({ required: true, trim: true, index: true })
  ref: string;

  @Prop({ required: true, trim: true })
  title: string;

  @Prop({ trim: true, default: '' })
  description: string;

  @Prop({ trim: true, default: '' })
  occasion: string;

  @Prop({ trim: true, default: '' })
  location: string;

  // The event date — daysToGo is derived from this at read time.
  @Prop({ required: true })
  eventDate: Date;

  // Snapshot of the accepted quotation's grand total (rupees).
  @Prop({ default: 0, min: 0 })
  amount: number;

  @Prop({ default: 0, min: 0, max: 100 })
  progress: number;

  // Checklist shown on the card / details.
  @Prop({ type: [{ label: String, done: Boolean, _id: false }], default: [] })
  steps: { label: string; done: boolean }[];

  // Chronological status history.
  @Prop({ type: [BookingTimelineEntrySchema], default: [] })
  timeline: BookingTimelineEntry[];

  // Organizer's own execution board for delivering this booking.
  @Prop({ type: [BookingTaskSchema], default: [] })
  tasks: BookingTask[];

  @Prop({ type: String, enum: BookingStatus, default: BookingStatus.PENDING, index: true })
  status: BookingStatus;

  // Provided by { timestamps: true } — declared so they are typed on the document.
  createdAt?: Date;
  updatedAt?: Date;
}

export const BookingSchema = SchemaFactory.createForClass(Booking);

// Fast lookup of a customer's bookings by recency and status.
BookingSchema.index({ customer: 1, status: 1 });
BookingSchema.index({ customer: 1, createdAt: -1 });
