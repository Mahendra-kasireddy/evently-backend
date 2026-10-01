import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { idJsonTransform } from '../../../common/utils/id-transform';
import { EventBookingStatus, EventPaymentStatus } from '../public-event.constants';

export type EventBookingDocument = HydratedDocument<EventBooking>;

/**
 * One customer's purchase of one ticket type on one event.
 *
 * The booking is the money; the tickets it mints are the seats. They are
 * separate records because one booking of four tickets is four QRs and four
 * independent check-ins, and a party that walks in two at a time has to be
 * able to.
 */
@Schema({ timestamps: true, toJSON: idJsonTransform() })
export class EventBooking {
  @Prop({ type: Types.ObjectId, ref: 'PublicEvent', required: true, index: true })
  event: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'OrganizerProfile', required: true, index: true })
  organizer: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  customer: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'EventTicketType', required: true })
  ticketType: Types.ObjectId;

  @Prop({ type: Number, required: true, min: 1 })
  quantity: number;

  /** Unit price at the moment of sale, kept so a later price change is not retroactive. */
  @Prop({ type: Number, required: true, min: 0 })
  unitPrice: number;

  /** quantity × unitPrice, computed on the server. Never sent by a client. */
  @Prop({ type: Number, required: true, min: 0 })
  amount: number;

  @Prop({
    type: String,
    enum: Object.values(EventPaymentStatus),
    default: EventPaymentStatus.PENDING,
    index: true,
  })
  paymentStatus: EventPaymentStatus;

  @Prop({
    type: String,
    enum: Object.values(EventBookingStatus),
    default: EventBookingStatus.PENDING,
    index: true,
  })
  status: EventBookingStatus;

  /** The gateway's own reference, for reconciliation. Organizers never edit this. */
  @Prop({ trim: true, default: '' })
  paymentReference: string;

  /** A short human reference the attendee can quote at the door. */
  @Prop({ trim: true, required: true, unique: true })
  reference: string;
}

export const EventBookingSchema = SchemaFactory.createForClass(EventBooking);

EventBookingSchema.index({ event: 1, createdAt: -1 });
EventBookingSchema.index({ customer: 1, createdAt: -1 });
