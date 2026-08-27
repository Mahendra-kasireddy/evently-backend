import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SubvendorService } from './subvendor.service';
import { AdminSubvendorService } from './admin-subvendor.service';
import { SubvendorController, OrganizerSubvendorController } from './subvendor.controller';
import { AdminSubvendorController } from './admin-subvendor.controller';
import { SubVendorProfile, SubVendorProfileSchema } from './schemas/subvendor-profile.schema';
import { SubVendorLink, SubVendorLinkSchema } from './schemas/subvendor-link.schema';
import { User, UserSchema } from '../user/schemas/user.schema';
import { Booking, BookingSchema } from '../booking/schemas/booking.schema';
import { UserModule } from '../user/user.module';
import { OrganizerModule } from '../organizer/organizer.module';
import { AuthModule } from '../auth/auth.module';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SubVendorProfile.name, schema: SubVendorProfileSchema },
      { name: SubVendorLink.name, schema: SubVendorLinkSchema },
      // Registered directly (not their modules) so the admin roster can read
      // the account behind a vendor and the tasks assigned to them without
      // building a module cycle back through UserModule / BookingModule.
      { name: User.name, schema: UserSchema },
      { name: Booking.name, schema: BookingSchema },
    ]),
    UserModule,
    OrganizerModule,
    AuthModule,
    NotificationModule,
  ],
  controllers: [SubvendorController, OrganizerSubvendorController, AdminSubvendorController],
  providers: [SubvendorService, AdminSubvendorService],
  exports: [SubvendorService],
})
export class SubvendorModule {}
