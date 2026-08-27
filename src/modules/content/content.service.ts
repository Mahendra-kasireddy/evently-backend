import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Content, ContentDocument } from './schemas/content.schema';
import { Booking, BookingDocument, BookingStatus } from '../booking/schemas/booking.schema';
import {
  OnboardingStatus,
  OrganizerProfile,
  OrganizerProfileDocument,
} from '../organizer/schemas/organizer-profile.schema';

/**
 * The three figures the landing hero shows.
 *
 * Every one is counted from real documents at request time. A figure with
 * nothing behind it comes back as null rather than 0 or a rounded-up guess, and
 * the client hides that card — the landing page must not make a claim the
 * database cannot support.
 */
export interface PlatformStatistics {
  /** Bookings actually delivered. */
  celebrationsPlanned: number | null;
  /** Review-weighted mean across organizers who have been rated. */
  averageRating: number | null;
  /** How many of those ratings it is the mean of. */
  ratingCount: number | null;
  /** Share of live organizers who completed verification, 0–100. */
  verifiedShare: number | null;
  /** Distinct customers with a delivered booking. */
  familiesServed: number | null;
}

export const CUSTOMER_HOME_KEY = 'customer-home';

@Injectable()
export class ContentService {
  constructor(
    @InjectModel(Content.name) private readonly contentModel: Model<ContentDocument>,
    @InjectModel(Booking.name) private readonly bookingModel: Model<BookingDocument>,
    @InjectModel(OrganizerProfile.name)
    private readonly organizerModel: Model<OrganizerProfileDocument>,
  ) {}

  /** Returns the editable copy blob for a content key. */
  async getData(key: string): Promise<Record<string, unknown>> {
    const doc = await this.contentModel.findOne({ key }).exec();
    if (!doc) {
      throw new NotFoundException(`Content "${key}" not found — run the seed.`);
    }
    return doc.data;
  }

  /**
   * Real platform statistics for the landing hero.
   *
   * Replaces the invented figures this page used to carry. Each is null when
   * there is genuinely nothing to report, which is a different statement from
   * zero and is why the type allows it.
   */
  async getPlatformStatistics(): Promise<PlatformStatistics> {
    const [delivered, families, rated, liveOrganizers, approvedOrganizers] = await Promise.all([
      this.bookingModel.countDocuments({ status: BookingStatus.COMPLETED }).exec(),
      // Distinct customers, not bookings: one family booking three times is one
      // family, and counting bookings here would inflate the number.
      this.bookingModel.distinct('customer', { status: BookingStatus.COMPLETED }).exec(),
      this.organizerModel
        .aggregate<{ weighted: number; reviews: number }>([
          { $match: { active: true, reviews: { $gt: 0 } } },
          {
            $group: {
              _id: null,
              // Weighted by review count: a 5.0 from one review must not carry
              // the same weight as a 4.6 from two hundred.
              weighted: { $sum: { $multiply: ['$rating', '$reviews'] } },
              reviews: { $sum: '$reviews' },
            },
          },
        ])
        .exec(),
      this.organizerModel.countDocuments({ active: true }).exec(),
      this.organizerModel
        .countDocuments({ active: true, onboardingStatus: OnboardingStatus.APPROVED })
        .exec(),
    ]);

    const totals = rated[0];
    const averageRating =
      totals && totals.reviews > 0
        ? Math.round((totals.weighted / totals.reviews) * 10) / 10
        : null;

    return {
      celebrationsPlanned: delivered > 0 ? delivered : null,
      averageRating,
      ratingCount: totals && totals.reviews > 0 ? totals.reviews : null,
      verifiedShare:
        liveOrganizers > 0 ? Math.round((approvedOrganizers / liveOrganizers) * 100) : null,
      familiesServed: families.length > 0 ? families.length : null,
    };
  }
}
