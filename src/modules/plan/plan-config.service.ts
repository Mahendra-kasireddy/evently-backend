import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { ContentService } from '../content/content.service';
import { StoredFile } from '../organizer/schemas/organizer-profile.schema';
import { PlanOccasion, PlanOccasionDocument } from './schemas/plan-occasion.schema';
import { PlanSubmission, PlanSubmissionDocument } from './schemas/plan-submission.schema';
import {
  OrganizerProfile,
  OrganizerProfileDocument,
} from '../organizer/schemas/organizer-profile.schema';
import { PlanCity, PlanCityDocument } from './schemas/plan-city.schema';
import { PlanGuestRange, PlanGuestRangeDocument } from './schemas/plan-guest-range.schema';
import { PlanBudgetRange, PlanBudgetRangeDocument } from './schemas/plan-budget-range.schema';
import {
  PlanServiceCategory,
  PlanServiceCategoryDocument,
} from './schemas/plan-service-category.schema';

/** Content key holding the Plan Event copy/config (non-list CMS fields). */
export const CUSTOMER_PLAN_KEY = 'customer-plan';

export interface PlanOccasionView {
  id: string;
  label: string;
  art: string;
  /**
   * An uploaded photograph for this tile, or '' when none has been set.
   *
   * '' is the ordinary case, not an error: the client draws the illustration
   * keyed by `art` instead. A tile is never blank for want of a photo.
   */
  imageUrl: string;
}
/**
 * An occasion as the home grid shows it: what it is called, and the one honest
 * line under it.
 */
export interface OccasionTileView extends PlanOccasionView {
  /**
   * The lowest base price among organizers who actually serve this occasion,
   * in rupees. 0 when none of them has published one — the tile then carries
   * no price line rather than "From ₹0".
   */
  fromPrice: number;
  /**
   * True for the single occasion most people have planned here. Derived by
   * counting real submissions, so it moves as the platform does, and false for
   * every occasion when there are no submissions to compare.
   */
  mostPlanned: boolean;
}

/** An occasion or category as the admin console lists it. */
export interface AdminTileView {
  key: string;
  label: string;
  /** The illustration key this tile falls back to — `art` or `icon`. */
  art: string;
  active: boolean;
  imageUrl: string;
}

/** Records when a picture was attached, so the row is not silent about it. */
function stamp(image: StoredFile | null): StoredFile | null {
  return image ? { ...image, uploadedAt: image.uploadedAt ?? new Date() } : null;
}

export interface PlanServiceCategoryView {
  id: string;
  title: string;
  subtitle: string;
  icon: string;
  /** As above: '' means "draw the icon", not "something is missing". */
  imageUrl: string;
}

/**
 * Assembles the Plan Event wizard config. List data (occasions, cities, guest
 * ranges, service categories) comes from normalized collections; the remaining
 * copy (steps, trust, ideas, filters, banners…) comes from the CMS content blob.
 * The composed shape is byte-compatible with what the client already consumes.
 */
@Injectable()
export class PlanConfigService {
  constructor(
    private readonly contentService: ContentService,
    @InjectModel(PlanOccasion.name)
    private readonly occasionModel: Model<PlanOccasionDocument>,
    @InjectModel(PlanCity.name)
    private readonly cityModel: Model<PlanCityDocument>,
    @InjectModel(PlanGuestRange.name)
    private readonly guestRangeModel: Model<PlanGuestRangeDocument>,
    @InjectModel(PlanBudgetRange.name)
    private readonly budgetRangeModel: Model<PlanBudgetRangeDocument>,
    @InjectModel(PlanServiceCategory.name)
    private readonly serviceCategoryModel: Model<PlanServiceCategoryDocument>,
    @InjectModel(PlanSubmission.name)
    private readonly submissionModel: Model<PlanSubmissionDocument>,
    @InjectModel(OrganizerProfile.name)
    private readonly organizerModel: Model<OrganizerProfileDocument>,
  ) {}

  async getOccasions(): Promise<PlanOccasionView[]> {
    const docs = await this.occasionModel
      .find({ active: true })
      .sort({ order: 1, label: 1 })
      .exec();
    return docs.map((o) => ({
      id: o.key,
      label: o.label,
      art: o.art,
      imageUrl: o.image?.url ?? '',
    }));
  }

  /**
   * The occasion grid on Home.
   *
   * Both extra facts are counted rather than configured. The price is the
   * cheapest an organizer serving that occasion has published, which is what
   * "from" means; the badge goes to whichever occasion has the most plan
   * submissions, and to none at all when there are none — a "Most planned"
   * label on an empty platform is a claim about other customers who do not
   * exist. Two aggregates cover every occasion, not one query per tile.
   */
  async getOccasionTiles(): Promise<OccasionTileView[]> {
    const occasions = await this.getOccasions();
    if (occasions.length === 0) return [];

    const keys = occasions.map((o) => o.id);
    const [prices, counts] = await Promise.all([
      this.organizerModel
        .aggregate<{
          _id: string;
          fromPrice: number;
        }>([
          { $match: { active: true, basePrice: { $gt: 0 }, occasions: { $in: keys } } },
          { $unwind: '$occasions' },
          { $match: { occasions: { $in: keys } } },
          { $group: { _id: '$occasions', fromPrice: { $min: '$basePrice' } } },
        ])
        .exec(),
      this.submissionModel
        .aggregate<{
          _id: string;
          count: number;
        }>([
          { $match: { occasion: { $in: keys } } },
          { $group: { _id: '$occasion', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 1 },
        ])
        .exec(),
    ]);

    const priceByOccasion = new Map(prices.map((row) => [row._id, row.fromPrice]));
    const mostPlannedKey = counts[0]?.count ? counts[0]._id : null;

    return occasions.map((occasion) => ({
      ...occasion,
      fromPrice: priceByOccasion.get(occasion.id) ?? 0,
      mostPlanned: occasion.id === mostPlannedKey,
    }));
  }

  async getCities(): Promise<string[]> {
    const docs = await this.cityModel.find({ active: true }).sort({ order: 1, name: 1 }).exec();
    return docs.map((c) => c.name);
  }

  async getGuestRanges(): Promise<string[]> {
    const docs = await this.guestRangeModel.find({ active: true }).sort({ order: 1 }).exec();
    return docs.map((g) => g.value);
  }

  async getBudgetRanges(): Promise<string[]> {
    const docs = await this.budgetRangeModel.find({ active: true }).sort({ order: 1 }).exec();
    return docs.map((b) => b.value);
  }

  async getServiceCategories(): Promise<PlanServiceCategoryView[]> {
    const docs = await this.serviceCategoryModel
      .find({ active: true })
      .sort({ order: 1, title: 1 })
      .exec();
    return docs.map((c) => ({
      id: c.key,
      title: c.title,
      subtitle: c.subtitle,
      icon: c.icon,
      imageUrl: c.image?.url ?? '',
    }));
  }

  // ---------------------------------------------------------------------------
  // Tile pictures (admin)
  //
  // An absent picture is the ordinary state: `imageUrl` comes back '' and the
  // client draws the illustration it always has. Nothing here makes a photo
  // required, and clearing one is a supported outcome rather than a failure.
  // ---------------------------------------------------------------------------

  /** Every occasion and category, active or not, so an admin sees the gaps. */
  async listTilesForAdmin(): Promise<{
    occasions: AdminTileView[];
    categories: AdminTileView[];
  }> {
    const [occasions, categories] = await Promise.all([
      this.occasionModel.find().sort({ order: 1, label: 1 }).exec(),
      this.serviceCategoryModel.find().sort({ order: 1, title: 1 }).exec(),
    ]);

    return {
      occasions: occasions.map((o) => ({
        key: o.key,
        label: o.label,
        art: o.art,
        active: o.active,
        imageUrl: o.image?.url ?? '',
      })),
      categories: categories.map((c) => ({
        key: c.key,
        label: c.title,
        art: c.icon,
        active: c.active,
        imageUrl: c.image?.url ?? '',
      })),
    };
  }

  async setOccasionImage(key: string, image: StoredFile | null): Promise<AdminTileView> {
    const doc = await this.occasionModel.findOne({ key: key.trim() }).exec();
    if (!doc) throw new NotFoundException('Occasion not found');
    doc.image = stamp(image);
    await doc.save();
    return {
      key: doc.key,
      label: doc.label,
      art: doc.art,
      active: doc.active,
      imageUrl: doc.image?.url ?? '',
    };
  }

  async setCategoryImage(key: string, image: StoredFile | null): Promise<AdminTileView> {
    const doc = await this.serviceCategoryModel.findOne({ key: key.trim() }).exec();
    if (!doc) throw new NotFoundException('Category not found');
    doc.image = stamp(image);
    await doc.save();
    return {
      key: doc.key,
      label: doc.title,
      art: doc.icon,
      active: doc.active,
      imageUrl: doc.image?.url ?? '',
    };
  }

  /** Full wizard screen payload (aggregated — one request for the whole screen). */
  async getPlanScreen(): Promise<Record<string, unknown>> {
    const [copy, occasions, cityOptions, guestOptions, budgetOptions, categories] =
      await Promise.all([
        this.contentService.getData(CUSTOMER_PLAN_KEY),
        this.getOccasions(),
        this.getCities(),
        this.getGuestRanges(),
        this.getBudgetRanges(),
        this.getServiceCategories(),
      ]);

    return {
      ...copy,
      occasions,
      cityOptions,
      guestOptions,
      budgetOptions,
      categories,
    };
  }
}
