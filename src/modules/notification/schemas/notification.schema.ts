import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { idJsonTransform } from '../../../common/utils/id-transform';
import { HydratedDocument, Types } from 'mongoose';

export type NotificationDocument = HydratedDocument<Notification>;

export enum NotificationType {
  BOOKING = 'booking',
  QUOTE = 'quote',
  PAYMENT = 'payment',
  SYSTEM = 'system',
}

@Schema({
  timestamps: true,
  collection: 'notifications',
  toJSON: idJsonTransform(),
})
export class Notification {
  // Recipient.
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  user: Types.ObjectId;

  @Prop({ type: String, enum: NotificationType, default: NotificationType.SYSTEM })
  type: NotificationType;

  @Prop({ required: true, trim: true })
  title: string;

  @Prop({ trim: true, default: '' })
  body: string;

  // Optional deep link, e.g. "/workspace" or "/quote/123".
  @Prop({ trim: true })
  link?: string;

  @Prop({ default: false, index: true })
  read: boolean;

  @Prop()
  readAt?: Date;
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);

// Inbox query: a user's notifications, newest first, filterable by read state.
NotificationSchema.index({ user: 1, read: 1, createdAt: -1 });
