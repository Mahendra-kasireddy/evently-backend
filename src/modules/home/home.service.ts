import { Injectable } from '@nestjs/common';
import { UserService } from '../user/user.service';
import { ContentService, CUSTOMER_HOME_KEY } from '../content/content.service';
import { PackageService } from '../package/package.service';
import { OrganizerService } from '../organizer/organizer.service';
import { BookingService } from '../booking/booking.service';
import { NotificationService } from '../notification/notification.service';
import { CurrentEventService } from './current-event.service';

/**
 * Home screen aggregator (BFF). Composes the domain services into the single
 * payload the customer home screen needs — one round-trip for the frontend.
 * Domain logic stays in the domain modules; this only orchestrates.
 */
@Injectable()
export class HomeService {
  constructor(
    private readonly userService: UserService,
    private readonly contentService: ContentService,
    private readonly packageService: PackageService,
    private readonly organizerService: OrganizerService,
    private readonly bookingService: BookingService,
    private readonly notificationService: NotificationService,
    private readonly currentEventService: CurrentEventService,
  ) {}

  async getHomeFeed(userId: string) {
    // The customer's city gates the "near you" section, so it is resolved first
    // and the rest of the payload is composed around it.
    const user = await this.userService.getProfileSummary(userId);

    const [content, packages, nearby, booking, currentEvent, unreadCount] = await Promise.all([
      this.contentService.getData(CUSTOMER_HOME_KEY),
      this.packageService.findActive(),
      this.organizerService.findTopNear(user.location),
      // Ongoing booking (confirmed / in progress) behind Home's rich "BOOKED"
      // card. Null for every other stage, where the compact `currentEvent`
      // widget is shown instead — the two are mutually exclusive on Home.
      this.bookingService.getActiveForUser(userId),
      this.currentEventService.resolve(userId),
      this.notificationService.unreadCount(userId),
    ]);

    return {
      user,
      content,
      packages,
      topOrganizers: nearby.organizers,
      /**
       * Which pass produced `topOrganizers`: 'city' when they really are in the
       * customer's city, 'all' when nothing local existed and these come from
       * further afield. The client labels the section accordingly rather than
       * calling distant organizers "near you".
       */
      topOrganizersScope: nearby.scope,
      booking,
      currentEvent,
      unreadCount,
    };
  }
}
