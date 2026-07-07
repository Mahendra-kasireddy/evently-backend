import { Module } from '@nestjs/common';
import { HomeService } from './home.service';
import { HomeController } from './home.controller';
import { UserModule } from '../user/user.module';
import { ContentModule } from '../content/content.module';
import { PackageModule } from '../package/package.module';
import { OrganizerModule } from '../organizer/organizer.module';
import { BookingModule } from '../booking/booking.module';
import { NotificationModule } from '../notification/notification.module';

/**
 * Home screen module (BFF). Depends on the domain modules and exposes a single
 * aggregated endpoint for the customer home screen.
 */
@Module({
  imports: [
    UserModule,
    ContentModule,
    PackageModule,
    OrganizerModule,
    BookingModule,
    NotificationModule,
  ],
  controllers: [HomeController],
  providers: [HomeService],
})
export class HomeModule {}
