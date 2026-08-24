import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { IdeaService } from './idea.service';
import { IdeaController } from './idea.controller';
import { BookingIdea, BookingIdeaSchema } from './schemas/booking-idea.schema';
import { BoardVision, BoardVisionSchema } from './schemas/board-vision.schema';
import { Booking, BookingSchema } from '../booking/schemas/booking.schema';
import { User, UserSchema } from '../user/schemas/user.schema';
import { OrganizerModule } from '../organizer/organizer.module';
import { AuthModule } from '../auth/auth.module';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: BookingIdea.name, schema: BookingIdeaSchema },
      { name: BoardVision.name, schema: BoardVisionSchema },
      // Schemas rather than the owning modules: BookingModule already depends on
      // several of these, so importing it here would be a cycle.
      { name: Booking.name, schema: BookingSchema },
      { name: User.name, schema: UserSchema },
    ]),
    OrganizerModule,
    AuthModule,
    NotificationModule,
  ],
  controllers: [IdeaController],
  providers: [IdeaService],
  exports: [IdeaService],
})
export class IdeaModule {}
