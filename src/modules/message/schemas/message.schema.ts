import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { idJsonTransform } from '../../../common/utils/id-transform';

export type MessageDocument = HydratedDocument<Message>;

/** Which side of the thread wrote this. */
export enum MessageSender {
  CUSTOMER = 'customer',
  ORGANIZER = 'organizer',
}

/**
 * One message in a thread.
 *
 * `sender` is a role rather than a comparison against the reading user's id,
 * so a thread renders correctly for whoever opens it without either client
 * needing to know who the other party is.
 */
@Schema({
  timestamps: true,
  collection: 'messages',
  toJSON: idJsonTransform(),
})
export class Message {
  @Prop({ type: Types.ObjectId, ref: 'Conversation', required: true, index: true })
  conversation: Types.ObjectId;

  @Prop({ type: String, enum: MessageSender, required: true })
  sender: MessageSender;

  /** The account that actually wrote it — for audit, never shown as a name. */
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  senderUser: Types.ObjectId;

  @Prop({ required: true, trim: true, maxlength: 2000 })
  text: string;

  createdAt?: Date;
  updatedAt?: Date;
}

export const MessageSchema = SchemaFactory.createForClass(Message);

/** The thread view is always "this conversation, newest last". */
MessageSchema.index({ conversation: 1, createdAt: 1 });
