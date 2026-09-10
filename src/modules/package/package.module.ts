import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PackageService } from './package.service';
import { PackageController } from './package.controller';
import { Package, PackageSchema } from './schemas/package.schema';
import {
  OrganizerProfile,
  OrganizerProfileSchema,
} from '../organizer/schemas/organizer-profile.schema';
import { Booking, BookingSchema } from '../booking/schemas/booking.schema';

@Module({
  /*
   * The organizer and booking schemas are registered here rather than their
   * modules being imported: a package card only reads those documents, and
   * pulling in OrganizerModule or BookingModule would drag their service
   * graphs — and BookingService already depends on this one.
   */
  imports: [
    MongooseModule.forFeature([
      { name: Package.name, schema: PackageSchema },
      { name: OrganizerProfile.name, schema: OrganizerProfileSchema },
      { name: Booking.name, schema: BookingSchema },
    ]),
  ],
  controllers: [PackageController],
  providers: [PackageService],
  exports: [PackageService],
})
export class PackageModule {}
