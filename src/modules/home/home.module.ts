import { Module } from '@nestjs/common';
import { HomeService } from './home.service';
import { HomeController } from './home.controller';
import { CurrentEventService } from './current-event.service';
import { UserModule } from '../user/user.module';
import { ContentModule } from '../content/content.module';
import { PackageModule } from '../package/package.module';
import { OrganizerModule } from '../organizer/organizer.module';
import { BookingModule } from '../booking/booking.module';
import { NotificationModule } from '../notification/notification.module';
import { PlanModule } from '../plan/plan.module';
import { QuoteModule } from '../quote/quote.module';

/**
 * Home screen module (BFF). Depends on the domain modules and exposes a single
 * aggregated endpoint for the customer home screen. CurrentEventService composes
 * plan + quote + booking + notification into one "Current Event".
 */
@Module({
  imports: [
    UserModule,
    ContentModule,
    PackageModule,
    OrganizerModule,
    BookingModule,
    NotificationModule,
    PlanModule,
    QuoteModule,
  ],
  controllers: [HomeController],
  providers: [HomeService, CurrentEventService],
})
export class HomeModule {}
