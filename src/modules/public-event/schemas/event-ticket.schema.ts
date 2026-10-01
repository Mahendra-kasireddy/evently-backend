import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { idJsonTransform } from '../../../common/utils/id-transform';
import { EventTicketStatus } from '../public-event.constants';

export type EventTicketDocument = HydratedDocument<EventTicket>;

/**
 * One seat, one QR, one check-in.
 *
 * `qrToken` is the secret the door reads. It is written by the server, never
 * derived from anything a client knows, and never returned to anybody but the
 * ticket's own holder — which is why it is `select: false`: an organizer
 * listing their attendees gets names and statuses, not the tokens that would
 * let them walk somebody else's guest in.
 */
@Schema({ timestamps: true, toJSON: idJsonTransform() })
export class EventTicket {
  @Prop({ type: Types.ObjectId, ref: 'EventBooking', required: true, index: true })
  booking: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'PublicEvent', required: true, index: true })
  event: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'OrganizerProfile', required: true, index: true })
  organizer: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  customer: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'EventTicketType', required: true })
  ticketType: Types.ObjectId;

  @Prop({ required: true, unique: true, select: false })
  qrToken: string;

  /** The short code printed under the QR, for when a camera will not read it. */
  @Prop({ required: true, unique: true, trim: true })
  code: string;

  @Prop({
    type: String,
    enum: Object.values(EventTicketStatus),
    default: EventTicketStatus.VALID,
    index: true,
  })
  status: EventTicketStatus;

  @Prop({ type: Date, default: null })
  checkedInAt: Date | null;

  /** The user who scanned it — the organizer or one of their staff. */
  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  checkedInBy: Types.ObjectId | null;
}

export const EventTicketSchema = SchemaFactory.createForClass(EventTicket);

EventTicketSchema.index({ event: 1, status: 1 });
