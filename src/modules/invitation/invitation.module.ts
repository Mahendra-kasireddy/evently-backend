import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { InvitationService } from './invitation.service';
import { InvitationController } from './invitation.controller';
import { Invitation, InvitationSchema } from './schemas/invitation.schema';
import { Booking, BookingSchema } from '../booking/schemas/booking.schema';
import { OrganizerModule } from '../organizer/organizer.module';
import { AuthModule } from '../auth/auth.module';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Invitation.name, schema: InvitationSchema },
      { name: Booking.name, schema: BookingSchema },
    ]),
    OrganizerModule,
    AuthModule,
    NotificationModule,
  ],
  controllers: [InvitationController],
  providers: [InvitationService],
  exports: [InvitationService],
})
export class InvitationModule {}
