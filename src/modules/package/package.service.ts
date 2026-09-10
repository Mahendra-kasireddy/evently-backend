import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Package, PackageDocument } from './schemas/package.schema';
import {
  OrganizerProfile,
  OrganizerProfileDocument,
} from '../organizer/schemas/organizer-profile.schema';
import { Booking, BookingDocument, BookingStatus } from '../booking/schemas/booking.schema';

/** Who delivers a package, as its card names them. */
export interface PackageOrganizerView {
  id: string;
  name: string;
  initials: string;
  avatarColor: string;
  rating: number;
  reviews: number;
  /**
   * Bookings this organizer has taken since the start of the month.
   *
   * The organizer's, not the package's: nothing links a booking back to the
   * package that inspired it, so a per-package figure would be invented. This
   * one is counted from the bookings themselves, and the card says whose it is.
   */
  bookedThisMonth: number;
}

export interface PublicPackageView {
  id: string;
  badge: string;
  title: string;
  guests: string;
  budget: string;
  tags: string[];
  art: string;
  bannerNote: string;
  photoUrl: string;
  /** 0 when only the budget band is known — the card then shows the band. */
  price: number;
  /** 0 unless this is a real reduction; never a decorative "was" figure. */
  listPrice: number;
  organizer: PackageOrganizerView | null;
}

/** A booking that fell through is not one the organizer took. */
const LIVE_BOOKING_STATUSES = [
  BookingStatus.PENDING,
  BookingStatus.AWAITING_ORGANIZER,
  BookingStatus.CONFIRMED,
  BookingStatus.IN_PROGRESS,
  BookingStatus.COMPLETED,
];

@Injectable()
export class PackageService {
  constructor(
    @InjectModel(Package.name) private readonly packageModel: Model<PackageDocument>,
    @InjectModel(OrganizerProfile.name)
    private readonly organizerModel: Model<OrganizerProfileDocument>,
    @InjectModel(Booking.name) private readonly bookingModel: Model<BookingDocument>,
  ) {}

  /** Active packages for the home carousel, in display order. */
  findActive(): Promise<PackageDocument[]> {
    return this.packageModel.find({ active: true }).sort({ order: 1, createdAt: 1 }).exec();
  }

  /**
   * The same packages, with everything a card shows.
   *
   * The organizer's rating, review count and recent bookings are read live
   * rather than stored on the package, so a card can never quote a score its
   * organizer has since lost. One aggregate covers every organizer in the
   * list — a count per card would be a query per card.
   */
  async findActiveForCustomer(): Promise<PublicPackageView[]> {
    const packages = await this.findActive();
    const organizerIds = packages
      .map((p) => p.organizer)
      .filter((id): id is Types.ObjectId => !!id);

    const [organizers, counts] = await Promise.all([
      organizerIds.length
        ? this.organizerModel
            .find({ _id: { $in: organizerIds } })
            .select('name initials avatarColor rating reviews')
            .exec()
        : Promise.resolve([]),
      this.bookedThisMonth(organizerIds),
    ]);

    const byId = new Map(organizers.map((o) => [o._id.toString(), o]));

    return packages.map((p) => {
      const organizer = p.organizer ? byId.get(p.organizer.toString()) : undefined;
      return {
        id: p._id.toString(),
        badge: p.badge,
        title: p.title,
        guests: p.guests,
        budget: p.budget,
        tags: p.tags ?? [],
        art: p.art,
        bannerNote: p.bannerNote ?? '',
        photoUrl: p.photo?.url ?? '',
        price: p.price ?? 0,
        // A "was" price that is not above the current one is not a reduction.
        listPrice: (p.listPrice ?? 0) > (p.price ?? 0) ? p.listPrice : 0,
        organizer: organizer
          ? {
              id: organizer._id.toString(),
              name: organizer.name,
              initials: organizer.initials,
              avatarColor: organizer.avatarColor,
              rating: organizer.rating ?? 0,
              reviews: organizer.reviews ?? 0,
              bookedThisMonth: counts.get(organizer._id.toString()) ?? 0,
            }
          : null,
      };
    });
  }

  /**
   * How many bookings each of these organizers has taken this calendar month.
   *
   * Cancelled, declined and expired bookings are excluded: a booking that fell
   * through is not one the organizer took, and counting it would make a
   * struggling organizer look busy.
   */
  async bookedThisMonth(organizerIds: Types.ObjectId[]): Promise<Map<string, number>> {
    if (organizerIds.length === 0) return new Map();

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const rows = await this.bookingModel
      .aggregate<{ _id: Types.ObjectId; count: number }>([
        {
          $match: {
            organizer: { $in: organizerIds },
            createdAt: { $gte: monthStart },
            status: { $in: LIVE_BOOKING_STATUSES },
          },
        },
        { $group: { _id: '$organizer', count: { $sum: 1 } } },
      ])
      .exec();

    return new Map(rows.map((row) => [row._id.toString(), row.count]));
  }

  async findById(id: string): Promise<PackageDocument> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Package not found');
    const pkg = await this.packageModel.findById(id).exec();
    if (!pkg) throw new NotFoundException('Package not found');
    return pkg;
  }
}
