import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument, UserStatus } from '../user/schemas/user.schema';
import {
  OrganizerProfile,
  OrganizerProfileDocument,
  OnboardingStatus,
} from '../organizer/schemas/organizer-profile.schema';
import {
  SubVendorProfile,
  SubVendorProfileDocument,
} from '../subvendor/schemas/subvendor-profile.schema';
import {
  QuoteRequest,
  QuoteRequestDocument,
  QuoteRequestStatus,
} from '../quote/schemas/quote-request.schema';
import {
  Booking,
  BookingDocument,
  BookingStatus,
  AWAITING_ORGANIZER_STATUSES,
} from '../booking/schemas/booking.schema';
import {
  ContactRequest,
  ContactRequestDocument,
  ContactStatus,
} from '../contact/schemas/contact-request.schema';

/** One tile on the dashboard: a real count, and where it leads. */
export interface DashboardSection {
  key: string;
  label: string;
  total: number;
  /** The number worth acting on inside that section, when there is one. */
  attention: number;
}

/** One row in the "needs attention" queue. */
export interface AttentionItem {
  key: string;
  label: string;
  count: number;
  /** Console path, already filtered to exactly what the count refers to. */
  href: string;
  tone: 'urgent' | 'warn' | 'info';
}

export interface DashboardSummary {
  sections: DashboardSection[];
  attention: AttentionItem[];
  finance: { contractedValue: number; collected: number; outstanding: number };
  generatedAt: Date;
}

/**
 * The admin dashboard's numbers.
 *
 * It reads the schemas directly rather than importing each owning module: this
 * module would otherwise sit downstream of nearly every other one, and several
 * of them already depend on each other. Nothing here writes, and nothing here
 * computes a number that is not a count or a sum of stored documents — an
 * invented figure on an admin console is worse than no figure.
 */
@Injectable()
export class AdminDashboardService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(OrganizerProfile.name)
    private readonly organizerModel: Model<OrganizerProfileDocument>,
    @InjectModel(SubVendorProfile.name)
    private readonly vendorModel: Model<SubVendorProfileDocument>,
    @InjectModel(QuoteRequest.name) private readonly requestModel: Model<QuoteRequestDocument>,
    @InjectModel(Booking.name) private readonly bookingModel: Model<BookingDocument>,
    @InjectModel(ContactRequest.name)
    private readonly contactModel: Model<ContactRequestDocument>,
  ) {}

  async summary(): Promise<DashboardSummary> {
    const [
      users,
      suspendedUsers,
      organizers,
      organizersPending,
      organizersSubmitted,
      vendors,
      vendorsInactive,
      events,
      eventsQuoted,
      bookings,
      bookingsAwaiting,
      contacts,
      contactsNew,
      finance,
    ] = await Promise.all([
      this.userModel.countDocuments().exec(),
      this.userModel.countDocuments({ status: UserStatus.SUSPENDED }).exec(),
      this.organizerModel.countDocuments().exec(),
      this.organizerModel.countDocuments({ status: OnboardingStatus.PENDING_REVIEW }).exec(),
      this.organizerModel.countDocuments({ status: OnboardingStatus.SUBMITTED }).exec(),
      this.vendorModel.countDocuments().exec(),
      this.vendorModel.countDocuments({ active: false }).exec(),
      this.requestModel.countDocuments().exec(),
      this.requestModel.countDocuments({ status: QuoteRequestStatus.QUOTED }).exec(),
      this.bookingModel.countDocuments().exec(),
      this.bookingModel.countDocuments({ status: { $in: AWAITING_ORGANIZER_STATUSES } }).exec(),
      this.contactModel.countDocuments().exec(),
      this.contactModel.countDocuments({ status: ContactStatus.NEW }).exec(),
      this.financeTotals(),
    ]);

    const organizersToReview = organizersPending + organizersSubmitted;

    const sections: DashboardSection[] = [
      { key: 'users', label: 'Users', total: users, attention: suspendedUsers },
      { key: 'organizers', label: 'Organizers', total: organizers, attention: organizersToReview },
      { key: 'vendors', label: 'Vendors', total: vendors, attention: vendorsInactive },
      { key: 'events', label: 'Events', total: events, attention: eventsQuoted },
      { key: 'bookings', label: 'Bookings', total: bookings, attention: bookingsAwaiting },
      { key: 'contact', label: 'Messages', total: contacts, attention: contactsNew },
    ];

    /*
     * Only genuinely actionable rows, and only when the count is non-zero — a
     * queue full of "0 things to do" trains people to stop reading it. Each
     * href is the destination already filtered to what the number counts, so
     * clicking a row lands on exactly those records.
     */
    const attention: AttentionItem[] = (
      [
        {
          key: 'organizers-pending',
          label: 'Organizers waiting to be let into onboarding',
          count: organizersPending,
          href: '/organizers?status=pending_review',
          tone: 'urgent',
        },
        {
          key: 'organizers-submitted',
          label: 'Organizer profiles submitted for verification',
          count: organizersSubmitted,
          href: '/organizers?status=submitted',
          tone: 'urgent',
        },
        {
          key: 'contact-new',
          label: 'Support messages nobody has picked up',
          count: contactsNew,
          href: '/contact-us?status=new',
          tone: 'warn',
        },
        {
          key: 'bookings-awaiting',
          label: 'Paid bookings waiting on an organizer to confirm',
          count: bookingsAwaiting,
          href: '/bookings?status=awaiting_organizer',
          tone: 'warn',
        },
        {
          key: 'events-quoted',
          label: 'Events with quotes the customer has not chosen between',
          count: eventsQuoted,
          href: '/events?status=quoted',
          tone: 'info',
        },
        {
          key: 'users-suspended',
          label: 'Suspended accounts',
          count: suspendedUsers,
          href: '/users?status=suspended',
          tone: 'info',
        },
      ] as AttentionItem[]
    ).filter((item) => item.count > 0);

    return { sections, attention, finance, generatedAt: new Date() };
  }

  /**
   * Contracted value and what bookings record as collected.
   *
   * Cancelled, declined and expired bookings are excluded: money is not owed on
   * an agreement that no longer exists, and counting them would overstate the
   * outstanding figure.
   */
  private async financeTotals(): Promise<{
    contractedValue: number;
    collected: number;
    outstanding: number;
  }> {
    const [agg] = await this.bookingModel
      .aggregate<{ contractedValue: number; collected: number }>([
        {
          $match: {
            status: {
              $nin: [BookingStatus.CANCELLED, BookingStatus.REJECTED, BookingStatus.EXPIRED],
            },
          },
        },
        {
          $group: {
            _id: null,
            contractedValue: { $sum: '$amount' },
            collected: { $sum: { $ifNull: ['$amountPaid', 0] } },
          },
        },
      ])
      .exec();

    const contractedValue = agg?.contractedValue ?? 0;
    const collected = agg?.collected ?? 0;
    return { contractedValue, collected, outstanding: Math.max(0, contractedValue - collected) };
  }
}
