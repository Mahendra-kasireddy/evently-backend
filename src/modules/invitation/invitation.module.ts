import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { InvitationService } from './invitation.service';
import { InvitationController } from './invitation.controller';
import { Invitation, InvitationSchema } from './schemas/invitation.schema';
import { InvitationGuest, InvitationGuestSchema } from './schemas/invitation-guest.schema';
import { InvitationGuestService } from './guest/invitation-guest.service';
import { InvitationGuestController } from './guest/invitation-guest.controller';
import { WhatsAppProvider } from './guest/whatsapp.provider';
import { Booking, BookingSchema } from '../booking/schemas/booking.schema';
import { OrganizerModule } from '../organizer/organizer.module';
import { AuthModule } from '../auth/auth.module';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Invitation.name, schema: InvitationSchema },
      { name: InvitationGuest.name, schema: InvitationGuestSchema },
      { name: Booking.name, schema: BookingSchema },
    ]),
    OrganizerModule,
    AuthModule,
    NotificationModule,
  ],
  controllers: [InvitationController, InvitationGuestController],
  providers: [InvitationService, InvitationGuestService, WhatsAppProvider],
  exports: [InvitationService, InvitationGuestService],
})
export class InvitationModule {}
