import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PublicEventService } from './public-event.service';
import { OrganizerPublicEventController } from './organizer-public-event.controller';
import { PublicEvent, PublicEventSchema } from './schemas/public-event.schema';
import { EventTicketType, EventTicketTypeSchema } from './schemas/event-ticket-type.schema';
import { EventBooking, EventBookingSchema } from './schemas/event-booking.schema';
import { EventTicket, EventTicketSchema } from './schemas/event-ticket.schema';
import { CustomerPublicEventService } from './customer-public-event.service';
import { CustomerPublicEventController } from './customer-public-event.controller';
import { OrganizerModule } from '../organizer/organizer.module';
import { PaymentModule } from '../payment/payment.module';
import { UploadModule } from '../upload/upload.module';
import { EventMemory, EventMemorySchema } from './schemas/event-memory.schema';
import { EventMemoryService } from './event-memory.service';

/**
 * Public events: an organizer selling seats to strangers.
 *
 * A module of its own, as the feature document asks, and it borrows rather
 * than rebuilds — the organizer profile comes from OrganizerModule, and cover
 * images reach storage through the one shared /upload endpoint before an event
 * ever records them, so this module needs no upload dependency of its own.
 * Nothing about authentication, storage, media processing or payments is
 * reimplemented here.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PublicEvent.name, schema: PublicEventSchema },
      { name: EventTicketType.name, schema: EventTicketTypeSchema },
      { name: EventBooking.name, schema: EventBookingSchema },
      { name: EventTicket.name, schema: EventTicketSchema },
      { name: EventMemory.name, schema: EventMemorySchema },
    ]),
    OrganizerModule,
    /* Tickets are sold through the gateway the rest of Evently already uses:
       the same account, the same keys, the same signature check. Only the
       order record is this module's own, because its lifecycle is. */
    PaymentModule,
    /* Attendees' memories are stored through the one shared upload service. */
    UploadModule,
  ],
  controllers: [OrganizerPublicEventController, CustomerPublicEventController],
  providers: [PublicEventService, CustomerPublicEventService, EventMemoryService],
  exports: [PublicEventService],
})
export class PublicEventModule {}
