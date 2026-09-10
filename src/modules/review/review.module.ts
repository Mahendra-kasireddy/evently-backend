import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ReviewService } from './review.service';
import { ReviewController } from './review.controller';
import { Review, ReviewSchema } from './schemas/review.schema';
import { Booking, BookingSchema } from '../booking/schemas/booking.schema';
import {
  OrganizerProfile,
  OrganizerProfileSchema,
} from '../organizer/schemas/organizer-profile.schema';

/**
 * Customer reviews of organizers.
 *
 * The booking and organizer schemas are registered here rather than their
 * modules being imported: this module only reads a booking to authorise a
 * review and writes the organizer's cached average back. Importing
 * BookingModule would pull in a service graph that already depends on others.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Review.name, schema: ReviewSchema },
      { name: Booking.name, schema: BookingSchema },
      { name: OrganizerProfile.name, schema: OrganizerProfileSchema },
    ]),
  ],
  controllers: [ReviewController],
  providers: [ReviewService],
  exports: [ReviewService],
})
export class ReviewModule {}
