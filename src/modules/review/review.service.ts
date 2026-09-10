import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { REVIEW_TAG_LABEL, Review, ReviewDocument, ReviewTag } from './schemas/review.schema';
import { Booking, BookingDocument, BookingStatus } from '../booking/schemas/booking.schema';
import {
  OrganizerProfile,
  OrganizerProfileDocument,
} from '../organizer/schemas/organizer-profile.schema';
import { CreateReviewDto } from './dto/create-review.dto';

/** One review, as anyone reading an organizer's page sees it. */
export interface PublicReviewView {
  id: string;
  /** "Sandhya P." — a first name and an initial, never the full name. */
  authorName: string;
  authorInitials: string;
  rating: number;
  comment: string;
  tags: string[];
  /** "Naming ceremony · June 2026", or just one half when only one is known. */
  contextLabel: string;
  createdAt: Date | undefined;
}

export interface ReviewTagCount {
  key: string;
  label: string;
  count: number;
}

/** Everything the reviews screen's header needs, computed in one pass. */
export interface ReviewSummary {
  /** One decimal, e.g. 4.8. 0 when there are none. */
  average: number;
  total: number;
  /** Counts for 5,4,3,2,1 — always all five, so the bars line up. */
  histogram: Array<{ stars: number; count: number }>;
  /** The tags people actually picked, most-picked first. Empty when none. */
  tags: ReviewTagCount[];
}

const PAGE_SIZE = 20;

@Injectable()
export class ReviewService {
  constructor(
    @InjectModel(Review.name) private readonly reviewModel: Model<ReviewDocument>,
    @InjectModel(Booking.name) private readonly bookingModel: Model<BookingDocument>,
    @InjectModel(OrganizerProfile.name)
    private readonly organizerModel: Model<OrganizerProfileDocument>,
  ) {}

  // ---------------------------------------------------------------------------
  // Reading
  // ---------------------------------------------------------------------------

  /**
   * An organizer's reviews, newest first.
   *
   * Paged rather than returned whole: an established organizer accumulates
   * hundreds, and a profile screen that waits for all of them to render the
   * first three is a profile screen nobody scrolls to.
   */
  async listForOrganizer(
    organizerId: string,
    page = 1,
  ): Promise<{ items: PublicReviewView[]; total: number; hasMore: boolean }> {
    this.assertObjectId(organizerId);
    const organizer = new Types.ObjectId(organizerId);
    const skip = Math.max(0, page - 1) * PAGE_SIZE;

    const [docs, total] = await Promise.all([
      this.reviewModel
        .find({ organizer })
        .populate('customer', 'name')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(PAGE_SIZE)
        .exec(),
      this.reviewModel.countDocuments({ organizer }).exec(),
    ]);

    return {
      items: docs.map((doc) => this.toPublicView(doc)),
      total,
      hasMore: skip + docs.length < total,
    };
  }

  /**
   * The score, the star breakdown and the tag counts.
   *
   * Two aggregates rather than reading every review into memory to count them:
   * the numbers are the whole point of the header, and they must not get
   * slower as an organizer succeeds.
   */
  async summaryForOrganizer(organizerId: string): Promise<ReviewSummary> {
    this.assertObjectId(organizerId);
    const organizer = new Types.ObjectId(organizerId);

    const [byStars, byTag] = await Promise.all([
      this.reviewModel
        .aggregate<{
          _id: number;
          count: number;
        }>([{ $match: { organizer } }, { $group: { _id: '$rating', count: { $sum: 1 } } }])
        .exec(),
      this.reviewModel
        .aggregate<{
          _id: ReviewTag;
          count: number;
        }>([
          { $match: { organizer } },
          { $unwind: '$tags' },
          { $group: { _id: '$tags', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
        ])
        .exec(),
    ]);

    const counts = new Map(byStars.map((row) => [row._id, row.count]));
    // All five rows, always — a histogram missing its empty bars reads as a
    // different shape than the one the numbers describe.
    const histogram = [5, 4, 3, 2, 1].map((stars) => ({
      stars,
      count: counts.get(stars) ?? 0,
    }));

    const total = histogram.reduce((sum, row) => sum + row.count, 0);
    const weighted = histogram.reduce((sum, row) => sum + row.stars * row.count, 0);

    return {
      average: total > 0 ? Math.round((weighted / total) * 10) / 10 : 0,
      total,
      histogram,
      tags: byTag
        .filter((row) => !!REVIEW_TAG_LABEL[row._id])
        .map((row) => ({ key: row._id, label: REVIEW_TAG_LABEL[row._id], count: row.count })),
    };
  }

  // ---------------------------------------------------------------------------
  // Writing
  // ---------------------------------------------------------------------------

  /**
   * Leaves a review for a booking the caller owns and that is finished.
   *
   * Three gates, each closing a different hole: the booking must belong to
   * this customer (or anyone could review any organizer), it must be
   * completed (or an unhappy customer could review an event that has not
   * happened), and the unique index refuses a second one. The organizer,
   * occasion and date are read from the booking rather than accepted from the
   * client, so none of them can be pointed somewhere else.
   */
  async create(userId: string, bookingId: string, dto: CreateReviewDto): Promise<ReviewDocument> {
    this.assertObjectId(bookingId, 'booking');
    const booking = await this.bookingModel.findById(bookingId).exec();
    if (!booking) throw new NotFoundException('Booking not found');

    if (booking.customer.toString() !== userId) {
      throw new ForbiddenException('You can only review your own booking');
    }
    if (booking.status !== BookingStatus.COMPLETED) {
      throw new BadRequestException('You can review an event once it has been delivered');
    }
    if (!booking.organizer) {
      throw new BadRequestException('This booking has no organizer to review');
    }

    const existing = await this.reviewModel.exists({ booking: booking._id });
    if (existing) throw new BadRequestException('You have already reviewed this event');

    const review = await this.reviewModel.create({
      booking: booking._id,
      organizer: booking.organizer,
      customer: new Types.ObjectId(userId),
      rating: dto.rating,
      comment: dto.comment ?? '',
      tags: dto.tags ?? [],
      occasion: booking.occasion ?? '',
      eventDate: booking.eventDate ?? null,
    });

    await this.refreshOrganizerRating(booking.organizer);
    return review;
  }

  /** Whether this customer still owes a review for this booking. */
  async canReview(
    userId: string,
    bookingId: string,
  ): Promise<{ canReview: boolean; reason: string }> {
    this.assertObjectId(bookingId, 'booking');
    const booking = await this.bookingModel.findById(bookingId).exec();
    if (!booking || booking.customer.toString() !== userId) {
      return { canReview: false, reason: 'not_yours' };
    }
    if (booking.status !== BookingStatus.COMPLETED) {
      return { canReview: false, reason: 'not_completed' };
    }
    if (await this.reviewModel.exists({ booking: booking._id })) {
      return { canReview: false, reason: 'already_reviewed' };
    }
    return { canReview: true, reason: '' };
  }

  /**
   * Recomputes the organizer's cached rating from the reviews themselves.
   *
   * The profile's `rating` and `reviews` are read by every card in the app, so
   * they stay denormalised — but they are never written by hand. Deriving them
   * here means a card can never show an average that no set of reviews adds up
   * to, which is the failure this whole module exists to prevent.
   */
  private async refreshOrganizerRating(organizerId: Types.ObjectId): Promise<void> {
    const [row] = await this.reviewModel
      .aggregate<{
        average: number;
        total: number;
      }>([
        { $match: { organizer: organizerId } },
        { $group: { _id: null, average: { $avg: '$rating' }, total: { $sum: 1 } } },
      ])
      .exec();

    await this.organizerModel
      .findByIdAndUpdate(organizerId, {
        rating: row ? Math.round(row.average * 10) / 10 : 0,
        reviews: row?.total ?? 0,
      })
      .exec();
  }

  /**
   * "Sandhya P." — the reviewer's first name and one initial.
   *
   * A review is public, and the person who wrote it did not agree to have
   * their full name on the internet beside an opinion about a business. The
   * first name is enough for it to read as a person rather than as anonymous.
   */
  private toPublicView(doc: ReviewDocument): PublicReviewView {
    const customer = doc.customer as unknown as { name?: string } | null;
    const parts = (customer?.name ?? '').trim().split(/\s+/).filter(Boolean);
    const first = parts[0] ?? '';
    const lastInitial = parts.length > 1 ? `${parts[parts.length - 1][0]}.` : '';

    const month = doc.eventDate
      ? doc.eventDate.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
      : '';
    const occasion = doc.occasion ? titleize(doc.occasion) : '';

    return {
      id: doc._id.toString(),
      authorName: [first, lastInitial].filter(Boolean).join(' ') || 'A customer',
      authorInitials:
        ((first[0] ?? '') + (parts[parts.length - 1]?.[0] ?? '')).toUpperCase() || '·',
      rating: doc.rating,
      comment: doc.comment ?? '',
      tags: (doc.tags ?? []).map((tag) => REVIEW_TAG_LABEL[tag]).filter(Boolean),
      // Only the halves that exist, so a booking with no date reads shorter
      // rather than trailing a separator.
      contextLabel: [occasion, month].filter(Boolean).join(' · '),
      createdAt: doc.createdAt,
    };
  }

  private assertObjectId(id: string, subject: 'organizer' | 'booking' = 'organizer'): void {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(
        subject === 'booking' ? 'Booking not found' : 'Organizer not found',
      );
    }
  }
}

function titleize(value: string): string {
  const t = (value ?? '').trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
}
