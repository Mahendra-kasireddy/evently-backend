import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import { Package, PackageDocument } from '../package/schemas/package.schema';
import {
  OrganizerProfile,
  OrganizerProfileDocument,
} from '../organizer/schemas/organizer-profile.schema';
import { PackageService, PublicPackageView } from '../package/package.service';
import { OrganizerService, PublicOrganizerView } from '../organizer/organizer.service';
import { SearchQueryDto } from './dto/search-query.dto';

export interface SearchResults {
  packages: PublicPackageView[];
  organizers: PublicOrganizerView[];
  /** The two lengths, so a client can show "12 results" without adding up. */
  total: number;
}

/** Caps a single search's work regardless of how broad the query is. */
const RESULT_LIMIT = 30;

@Injectable()
export class SearchService {
  constructor(
    @InjectModel(Package.name) private readonly packageModel: Model<PackageDocument>,
    @InjectModel(OrganizerProfile.name)
    private readonly organizerModel: Model<OrganizerProfileDocument>,
    private readonly packageService: PackageService,
    private readonly organizerService: OrganizerService,
  ) {}

  /**
   * One search across the two things a customer can actually act on.
   *
   * Both halves run against the same filters and are returned separately
   * rather than interleaved, because a package and an organizer are not
   * comparable results — one is a fixed bundle, the other is somebody to ask.
   * Merging them into a single ranked list would force a relevance score
   * across two different kinds of thing, and the client renders them as two
   * sections anyway.
   */
  async search(query: SearchQueryDto): Promise<SearchResults> {
    const kind = query.kind ?? 'all';
    const [packages, organizers] = await Promise.all([
      kind === 'organizers' ? Promise.resolve([]) : this.searchPackages(query),
      kind === 'packages' ? Promise.resolve([]) : this.searchOrganizers(query),
    ]);

    return { packages, organizers, total: packages.length + organizers.length };
  }

  private async searchPackages(query: SearchQueryDto): Promise<PublicPackageView[]> {
    const filter: FilterQuery<PackageDocument> = { active: true };
    const term = this.term(query.q);
    if (term) {
      filter.$or = [{ title: term }, { tags: term }, { badge: term }, { guests: term }];
    }
    if (query.occasion) filter.art = query.occasion.trim().toLowerCase();
    // Only packages with a real price can be filtered by one; a package priced
    // only as a band is left in rather than silently excluded by a number
    // nobody set on it.
    if (query.minBudget != null) filter.price = { ...(filter.price ?? {}), $gte: query.minBudget };
    if (query.maxBudget != null) filter.price = { ...(filter.price ?? {}), $lte: query.maxBudget };

    const ids = await this.packageModel
      .find(filter)
      .sort({ order: 1, createdAt: 1 })
      .limit(RESULT_LIMIT)
      .select('_id')
      .exec();
    const matched = new Set(ids.map((doc) => doc._id.toString()));
    if (matched.size === 0) return [];

    /*
     * The public view is built by PackageService so a search result and a home
     * carousel card carry exactly the same organizer, rating and booking
     * figures. Filtering its output keeps one mapper rather than two that can
     * drift.
     */
    const views = await this.packageService.findActiveForCustomer();
    return views.filter((view) => matched.has(view.id));
  }

  private async searchOrganizers(query: SearchQueryDto): Promise<PublicOrganizerView[]> {
    const filter: FilterQuery<OrganizerProfileDocument> = { active: true };
    const term = this.term(query.q);
    if (term) {
      filter.$or = [
        { name: term },
        { businessName: term },
        { displayName: term },
        { tags: term },
        { primaryCategory: term },
      ];
    }
    if (query.occasion) filter.occasions = query.occasion.trim().toLowerCase();
    if (query.city) {
      const city = this.term(query.city);
      if (city) filter.$and = [{ $or: [{ city }, { serviceAreas: city }, { location: city }] }];
    }
    if (query.minBudget != null || query.maxBudget != null) {
      filter.basePrice = {
        ...(query.minBudget != null ? { $gte: query.minBudget } : {}),
        ...(query.maxBudget != null ? { $lte: query.maxBudget } : {}),
      };
    }

    const docs = await this.organizerModel
      .find(filter)
      .sort({ rank: -1, rating: -1 })
      .limit(RESULT_LIMIT)
      .exec();
    return docs.map((doc) => this.organizerService.toPublicViewOf(doc));
  }

  /**
   * A case-insensitive contains-match, with every regex metacharacter escaped.
   *
   * Without the escape, a customer typing `(` sends an invalid pattern and a
   * 500, and one typing `(a+)+$` sends a pattern that can pin a CPU. The
   * length cap on the DTO is the other half of that defence.
   */
  private term(value: string | undefined): RegExp | null {
    const trimmed = (value ?? '').trim();
    if (!trimmed) return null;
    return new RegExp(trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  }
}
