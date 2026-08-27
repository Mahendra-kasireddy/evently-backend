import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  SubVendorProfile,
  SubVendorProfileDocument,
  SubVendorCategory,
} from './schemas/subvendor-profile.schema';
import {
  SubVendorLink,
  SubVendorLinkDocument,
  SubVendorLinkStatus,
} from './schemas/subvendor-link.schema';
import { ListSubVendorsDto } from './dto/list-subvendors.dto';
import { PaginatedResult } from '../../common/dto/pagination.dto';
import { User, UserDocument, UserStatus } from '../user/schemas/user.schema';
import { Booking, BookingDocument } from '../booking/schemas/booking.schema';

export const CATEGORY_LABEL: Record<SubVendorCategory, string> = {
  [SubVendorCategory.FOOD]: 'Food & catering',
  [SubVendorCategory.WATER]: 'Water supply',
  [SubVendorCategory.DECOR]: 'Decor',
  [SubVendorCategory.PHOTOGRAPHY]: 'Photography',
  [SubVendorCategory.MUSIC]: 'Music',
  [SubVendorCategory.TRANSPORT]: 'Transport',
  [SubVendorCategory.PRIEST]: 'Priest',
  [SubVendorCategory.MEHENDI]: 'Mehendi',
};

/**
 * Admin view of the sub-vendor roster.
 *
 * Read plus one write: a sub-vendor can be taken off the roster (`active`),
 * which is the flag organizers' vendor pickers already respect. Their account
 * itself is suspended from the Users section — this does not duplicate that.
 */
@Injectable()
export class AdminSubvendorService {
  constructor(
    @InjectModel(SubVendorProfile.name)
    private readonly profileModel: Model<SubVendorProfileDocument>,
    @InjectModel(SubVendorLink.name)
    private readonly linkModel: Model<SubVendorLinkDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Booking.name) private readonly bookingModel: Model<BookingDocument>,
  ) {}

  async list(query: ListSubVendorsDto): Promise<PaginatedResult<Record<string, unknown>>> {
    const filter: Record<string, unknown> = {};
    if (query.category) filter.category = query.category;
    if (query.active !== undefined) filter.active = query.active;

    const search = query.search?.trim();
    if (search) {
      const safe = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const rx = new RegExp(safe, 'i');
      filter.$or = [{ fullName: rx }, { serviceArea: rx }];
    }

    const [rows, total] = await Promise.all([
      this.profileModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(query.skip)
        .limit(query.limit)
        .exec(),
      this.profileModel.countDocuments(filter).exec(),
    ]);

    // One query for every listed vendor's live link count, rather than one per row.
    const ids = rows.map((r) => r._id);
    const linkCounts = await this.linkModel
      .aggregate<{
        _id: Types.ObjectId;
        n: number;
      }>([
        { $match: { subVendor: { $in: ids }, status: SubVendorLinkStatus.ACTIVE } },
        { $group: { _id: '$subVendor', n: { $sum: 1 } } },
      ])
      .exec();
    const byVendor = new Map(linkCounts.map((c) => [c._id.toString(), c.n]));

    return {
      data: rows.map((r) => ({
        ...this.rowView(r),
        organizerCount: byVendor.get(r._id.toString()) ?? 0,
      })),
      meta: {
        total,
        page: query.page,
        limit: query.limit,
        pages: Math.max(1, Math.ceil(total / query.limit)),
      },
    };
  }

  /** Real per-category and per-state counts for the filter chips. */
  async counts(): Promise<Record<string, number>> {
    const [byCategory, active, all] = await Promise.all([
      this.profileModel
        .aggregate<{
          _id: SubVendorCategory;
          n: number;
        }>([{ $group: { _id: '$category', n: { $sum: 1 } } }])
        .exec(),
      this.profileModel.countDocuments({ active: true }).exec(),
      this.profileModel.countDocuments().exec(),
    ]);

    const counts: Record<string, number> = { all, active, inactive: all - active };
    for (const c of Object.values(SubVendorCategory)) counts[c] = 0;
    for (const g of byCategory) counts[g._id] = g.n;
    return counts;
  }

  /** One vendor: profile, the account behind it, its organizers and its work. */
  async detail(id: string): Promise<Record<string, unknown>> {
    const profile = await this.load(id);

    const [account, links, tasks] = await Promise.all([
      this.userModel.findById(profile.user).exec(),
      this.linkModel.find({ subVendor: profile._id }).populate('organizer', 'name').exec(),
      this.taskStats(profile._id),
    ]);

    return {
      ...this.rowView(profile),
      account: account
        ? {
            id: account._id.toString(),
            name: account.name ?? '',
            email: account.email ?? '',
            phone: account.phone ?? '',
            status: account.status,
            suspended: account.status === UserStatus.SUSPENDED,
          }
        : null,
      organizers: links.map((l) => {
        const org = l.organizer as unknown as { _id: Types.ObjectId; name?: string } | null;
        return {
          id: org?._id?.toString() ?? '',
          name: org?.name ?? 'Organizer',
          status: l.status,
          // Average of the ratings organizers have actually left, or null.
          rating: l.ratingCount > 0 ? Number((l.ratingTotal / l.ratingCount).toFixed(1)) : null,
          ratingCount: l.ratingCount,
        };
      }),
      work: tasks,
    };
  }

  /**
   * What this vendor has actually been assigned, counted across every booking's
   * task board. Bookings embed their tasks, so this is one pass over the
   * bookings that mention this vendor rather than a separate task collection.
   */
  private async taskStats(
    subVendorId: Types.ObjectId,
  ): Promise<{ assigned: number; accepted: number; completed: number; agreedValue: number }> {
    const bookings = await this.bookingModel
      .find({ 'tasks.subVendorId': subVendorId })
      .select('tasks')
      .exec();

    let assigned = 0;
    let accepted = 0;
    let completed = 0;
    let agreedValue = 0;
    for (const b of bookings) {
      for (const t of b.tasks ?? []) {
        if (t.subVendorId?.toString() !== subVendorId.toString()) continue;
        assigned += 1;
        if (t.assignmentStatus === 'accepted') accepted += 1;
        if (t.status === 'done') completed += 1;
        agreedValue += t.amount ?? 0;
      }
    }
    return { assigned, accepted, completed, agreedValue };
  }

  async setActive(id: string, active: boolean): Promise<Record<string, unknown>> {
    const profile = await this.load(id);
    profile.active = active;
    await profile.save();
    return this.detail(profile._id.toString());
  }

  private async load(id: string): Promise<SubVendorProfileDocument> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Vendor not found');
    const profile = await this.profileModel.findById(id).exec();
    if (!profile) throw new NotFoundException('Vendor not found');
    return profile;
  }

  private rowView(p: SubVendorProfileDocument): Record<string, unknown> {
    return {
      id: p._id.toString(),
      userId: p.user.toString(),
      fullName: p.fullName,
      initials: p.initials,
      avatarColor: p.avatarColor,
      category: p.category,
      categoryLabel: CATEGORY_LABEL[p.category] ?? p.category,
      serviceArea: p.serviceArea,
      baseRate: p.baseRate,
      baseRateUnit: p.baseRateUnit,
      minOrder: p.minOrder,
      active: p.active,
      createdAt: p.createdAt ?? null,
      updatedAt: p.updatedAt ?? null,
    };
  }
}
