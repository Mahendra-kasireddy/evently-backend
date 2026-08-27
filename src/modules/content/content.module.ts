import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ContentService } from './content.service';
import { ContentController } from './content.controller';
import { Content, ContentSchema } from './schemas/content.schema';
import { Booking, BookingSchema } from '../booking/schemas/booking.schema';
import {
  OrganizerProfile,
  OrganizerProfileSchema,
} from '../organizer/schemas/organizer-profile.schema';

@Module({
  imports: [
    // Schemas only, not the owning modules — the statistics are two counts and
    // an aggregate, and importing BookingModule/OrganizerModule here would add
    // a dependency cycle for no gain.
    MongooseModule.forFeature([
      { name: Content.name, schema: ContentSchema },
      { name: Booking.name, schema: BookingSchema },
      { name: OrganizerProfile.name, schema: OrganizerProfileSchema },
    ]),
  ],
  controllers: [ContentController],
  providers: [ContentService],
  exports: [ContentService],
})
export class ContentModule {}
