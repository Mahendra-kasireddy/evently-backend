import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { idJsonTransform } from '../../../common/utils/id-transform';
import {
  TICKET_DESCRIPTION_MAX,
  TICKET_NAME_MAX,
  TICKET_PER_CUSTOMER_MAX,
  TICKET_PRICE_MAX,
  TICKET_QUANTITY_MAX,
  TicketTypeStatus,
} from '../public-event.constants';

export type EventTicketTypeDocument = HydratedDocument<EventTicketType>;

/**
 * One kind of ticket on one event — General, VIP, Early Bird.
 *
 * Its own collection rather than an array on the event, for one reason: stock.
 * Selling a seat has to be a single atomic decrement that fails when there is
 * nothing left, and a subdocument inside a document somebody else is editing
 * cannot give that. Here it is one `findOneAndUpdate` with the remaining count
 * in the filter, which two simultaneous buyers cannot both win.
 */
@Schema({ timestamps: true, toJSON: idJsonTransform() })
export class EventTicketType {
  @Prop({ type: Types.ObjectId, ref: 'PublicEvent', required: true, index: true })
  event: Types.ObjectId;

  /* Carried alongside the event so every ownership check is one query. The
     event is the authority; this is a copy for the filter. */
  @Prop({ type: Types.ObjectId, ref: 'OrganizerProfile', required: true, index: true })
  organizer: Types.ObjectId;

  @Prop({ required: true, trim: true, maxlength: TICKET_NAME_MAX })
  name: string;

  @Prop({ trim: true, maxlength: TICKET_DESCRIPTION_MAX, default: '' })
  description: string;

  /** In the smallest unit of the listing currency. 0 is a free ticket. */
  @Prop({ type: Number, required: true, min: 0, max: TICKET_PRICE_MAX })
  price: number;

  /** How many were ever put on sale. */
  @Prop({ type: Number, required: true, min: 0, max: TICKET_QUANTITY_MAX })
  totalQuantity: number;

  /**
   * How many are left.
   *
   * The server's number, moved only by the server, and the one the oversell
   * guard filters on. It is seeded from `totalQuantity` and then diverges:
   * raising the total raises this by the difference rather than resetting it,
   * so an organizer adding stock does not hand back seats already sold.
   */
  @Prop({ type: Number, required: true, min: 0, max: TICKET_QUANTITY_MAX })
  availableQuantity: number;

  @Prop({ type: Date, default: null })
  salesStart: Date | null;

  @Prop({ type: Date, default: null })
  salesEnd: Date | null;

  /** 0 means no per-customer ceiling beyond the event's own. */
  @Prop({ type: Number, default: 0, min: 0, max: TICKET_PER_CUSTOMER_MAX })
  maxPerCustomer: number;

  @Prop({
    type: String,
    enum: Object.values(TicketTypeStatus),
    default: TicketTypeStatus.ACTIVE,
  })
  status: TicketTypeStatus;

  /**
   * Retired rather than deleted.
   *
   * A type somebody holds a ticket to cannot be removed — the ticket would
   * then name a thing that does not exist, and the attendee list would have a
   * hole in it where a paying customer used to be.
   */
  @Prop({ type: Boolean, default: false })
  archived: boolean;
}

export const EventTicketTypeSchema = SchemaFactory.createForClass(EventTicketType);

EventTicketTypeSchema.index({ event: 1, archived: 1 });
