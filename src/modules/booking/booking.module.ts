import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BookingService } from './booking.service';
import { BookingController } from './booking.controller';
import { Booking, BookingSchema } from './schemas/booking.schema';
import { Invitation, InvitationSchema } from '../invitation/schemas/invitation.schema';
import { QuoteModule } from '../quote/quote.module';
import { OrganizerModule } from '../organizer/organizer.module';
import { SubvendorModule } from '../subvendor/subvendor.module';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Booking.name, schema: BookingSchema },
      // Registered (not the whole InvitationModule) so the home card can read an
      // invitation's approval state without creating a module cycle.
      { name: Invitation.name, schema: InvitationSchema },
    ]),
    QuoteModule,
    OrganizerModule,
    SubvendorModule,
    NotificationModule,
  ],
  controllers: [BookingController],
  providers: [BookingService],
  exports: [BookingService],
})
export class BookingModule {}
