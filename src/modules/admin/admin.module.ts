import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AdminDashboardController } from './admin-dashboard.controller';
import { AdminDashboardService } from './admin-dashboard.service';
import { User, UserSchema } from '../user/schemas/user.schema';
import {
  OrganizerProfile,
  OrganizerProfileSchema,
} from '../organizer/schemas/organizer-profile.schema';
import {
  SubVendorProfile,
  SubVendorProfileSchema,
} from '../subvendor/schemas/subvendor-profile.schema';
import { QuoteRequest, QuoteRequestSchema } from '../quote/schemas/quote-request.schema';
import { Booking, BookingSchema } from '../booking/schemas/booking.schema';
import { ContactRequest, ContactRequestSchema } from '../contact/schemas/contact-request.schema';

/**
 * The console's cross-cutting summary. It registers the schemas it counts
 * rather than importing six feature modules — this module sits downstream of
 * nearly all of them, and several already depend on each other, so importing
 * would build cycles. It only ever reads.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: OrganizerProfile.name, schema: OrganizerProfileSchema },
      { name: SubVendorProfile.name, schema: SubVendorProfileSchema },
      { name: QuoteRequest.name, schema: QuoteRequestSchema },
      { name: Booking.name, schema: BookingSchema },
      { name: ContactRequest.name, schema: ContactRequestSchema },
    ]),
  ],
  controllers: [AdminDashboardController],
  providers: [AdminDashboardService],
})
export class AdminModule {}
