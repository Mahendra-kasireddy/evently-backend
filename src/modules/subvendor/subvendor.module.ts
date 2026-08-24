import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SubvendorService } from './subvendor.service';
import { SubvendorController, OrganizerSubvendorController } from './subvendor.controller';
import { SubVendorProfile, SubVendorProfileSchema } from './schemas/subvendor-profile.schema';
import { SubVendorLink, SubVendorLinkSchema } from './schemas/subvendor-link.schema';
import { UserModule } from '../user/user.module';
import { OrganizerModule } from '../organizer/organizer.module';
import { AuthModule } from '../auth/auth.module';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SubVendorProfile.name, schema: SubVendorProfileSchema },
      { name: SubVendorLink.name, schema: SubVendorLinkSchema },
    ]),
    UserModule,
    OrganizerModule,
    AuthModule,
    NotificationModule,
  ],
  controllers: [SubvendorController, OrganizerSubvendorController],
  providers: [SubvendorService],
  exports: [SubvendorService],
})
export class SubvendorModule {}
