import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { QuoteService } from './quote.service';
import { AdminEventService } from './admin-event.service';
import { QuoteController } from './quote.controller';
import { AdminEventController } from './admin-event.controller';
import { QuoteRequest, QuoteRequestSchema } from './schemas/quote-request.schema';
import { Quotation, QuotationSchema } from './schemas/quotation.schema';
import { User, UserSchema } from '../user/schemas/user.schema';
import { Booking, BookingSchema } from '../booking/schemas/booking.schema';
import { OrganizerModule } from '../organizer/organizer.module';
import { PlanModule } from '../plan/plan.module';
import {
  OrganizerProfile,
  OrganizerProfileSchema,
} from '../organizer/schemas/organizer-profile.schema';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: QuoteRequest.name, schema: QuoteRequestSchema },
      { name: Quotation.name, schema: QuotationSchema },
      // Registered directly rather than importing UserModule / BookingModule:
      // BookingModule already imports this one, so either would be a cycle.
      { name: User.name, schema: UserSchema },
      { name: Booking.name, schema: BookingSchema },
      // Read-only: the request view names the organizers that have not replied
      // yet. Registered rather than reached through OrganizerService, whose
      // lookups are built around one active profile at a time.
      { name: OrganizerProfile.name, schema: OrganizerProfileSchema },
    ]),
    OrganizerModule,
    // For the recommendation engine that picks a broadcast's recipients.
    PlanModule,
    NotificationModule,
  ],
  controllers: [QuoteController, AdminEventController],
  providers: [QuoteService, AdminEventService],
  exports: [QuoteService],
})
export class QuoteModule {}
