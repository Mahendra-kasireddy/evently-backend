import { Injectable } from '@nestjs/common';
import { Types } from 'mongoose';
import { UserService } from '../user/user.service';
import { ContentService, CUSTOMER_HOME_KEY } from '../content/content.service';
import { PackageService } from '../package/package.service';
import { OrganizerService, PublicOrganizerView } from '../organizer/organizer.service';
import { BookingService } from '../booking/booking.service';
import { NotificationService } from '../notification/notification.service';
import { CurrentEventService } from './current-event.service';
import { OfferService } from '../offer/offer.service';
import { CouponService } from '../coupon/coupon.service';
import { PlanConfigService } from '../plan/plan-config.service';

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
    private readonly offerService: OfferService,
    private readonly couponService: CouponService,
    private readonly planConfigService: PlanConfigService,
  ) {}

  async getHomeFeed(userId: string) {
    // The customer's city gates the "near you" section, so it is resolved first
    // and the rest of the payload is composed around it.
    const user = await this.userService.getProfileSummary(userId);

    const [
      content,
      packages,
      nearby,
      booking,
      liveEvents,
      unreadCount,
      offers,
      occasions,
      coupons,
    ] = await Promise.all([
      this.contentService.getData(CUSTOMER_HOME_KEY),
      // The customer view: each package's organizer, their live rating and how
      // busy they have been this month, rather than the raw documents.
      this.packageService.findActiveForCustomer(),
      this.organizerService.findTopNear(user.location),
      // Ongoing booking (confirmed / in progress) behind Home's rich "BOOKED"
      // card. Null at every other stage, where the `currentEvent` hero carries
      // the event instead.
      this.bookingService.getActiveForUser(userId),
      // Every live event, furthest along first — see `otherEvents` below.
      this.currentEventService.resolveAll(userId),
      this.notificationService.unreadCount(userId),
      // Only the offers whose window is open right now — see OfferService.
      this.offerService.findLive(),
      // The "Plan something new" grid: every occasion with the real lowest
      // price an organizer serving it has published.
      this.planConfigService.getOccasionTiles(),
      // Platform coupons this customer could still use — live, in window,
      // with slots left, and not already used up by them. See listClaimable.
      this.couponService.listClaimable(userId),
    ]);

    return {
      user,
      content,
      packages,
      topOrganizers: await this.withBookedThisMonth(nearby.organizers),
      /**
       * Which pass produced `topOrganizers`: 'city' when they really are in the
       * customer's city, 'all' when nothing local existed and these come from
       * further afield. The client labels the section accordingly rather than
       * calling distant organizers "near you".
       */
      topOrganizersScope: nearby.scope,
      booking,
      currentEvent: liveEvents[0] ?? null,
      /**
       * The customer's other live events, same furthest-along-first order,
       * never including the one above.
       *
       * Home shows the leader in its big card. Anything else on the go used to
       * be dropped here, so a confirmed booking hid a brief still collecting
       * quotes for a different occasion, and the customer's only clue that
       * their request existed was the Events tab.
       */
      otherEvents: liveEvents.slice(1),
      unreadCount,
      offers,
      occasions,
      /**
       * The coupons behind the home promo strip. Unlike `offers` — which are
       * admin-written copy with no discount attached — these are real,
       * spendable codes with real terms, so the strip advertises something the
       * customer can actually take to a checkout.
       */
      coupons,
      /**
       * How many packages this account has kept, so the header's heart can
       * carry its badge without the client fetching the list it is not showing.
       */
      savedPackageCount: await this.userService.countSavedPackages(userId),
    };
  }
  /**
   * How busy each of these organizers has been this month.
   *
   * Counted from the bookings themselves rather than stored on the profile —
   * a number an organizer could edit is not evidence of anything. Reuses the
   * package service's aggregate so a "booked this month" figure is identical
   * wherever it appears on the screen.
   */
  private async withBookedThisMonth(
    organizers: PublicOrganizerView[],
  ): Promise<Array<PublicOrganizerView & { bookedThisMonth: number }>> {
    const ids = organizers.map((o) => new Types.ObjectId(o.id));
    const counts = await this.packageService.bookedThisMonth(ids);
    return organizers.map((o) => ({ ...o, bookedThisMonth: counts.get(o.id) ?? 0 }));
  }
}
