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
    const [user, content, packages, topOrganizers, booking, currentEvent, unreadCount] =
      await Promise.all([
        this.userService.getProfileSummary(userId),
        this.contentService.getData(CUSTOMER_HOME_KEY),
        this.packageService.findActive(),
        this.organizerService.findTop(),
        // Retained for backward compatibility with any consumer of the raw
        // ongoing-booking card; the home screen now uses `currentEvent`.
        this.bookingService.getActiveForUser(userId),
        this.currentEventService.resolve(userId),
        this.notificationService.unreadCount(userId),
      ]);

    return { user, content, packages, topOrganizers, booking, currentEvent, unreadCount };
  }
}
