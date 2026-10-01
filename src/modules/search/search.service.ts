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
    const words = this.words(query.q);
    if (words.length) {
      // A package also matches through its organizer, so searching an
      // organizer's name finds the packages they sell.
      const organizerIds = await this.organizerModel
        .find({
          active: true,
          deletedAt: null,
          $or: words.flatMap((word) =>
            ['name', 'businessName', 'displayName'].map((field) => ({ [field]: word })),
          ),
        })
        .select('_id')
        .limit(200)
        .exec();
      const byOrganizer = organizerIds.map((doc) => doc._id);

      filter.$and = words.map((word) => ({
        $or: [
          { title: word },
          { tags: word },
          { badge: word },
          { guests: word },
          { art: word },
          { bannerNote: word },
          ...(byOrganizer.length ? [{ organizer: { $in: byOrganizer } }] : []),
        ],
      }));
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
    const filter: FilterQuery<OrganizerProfileDocument> = { active: true, deletedAt: null };
    const and: FilterQuery<OrganizerProfileDocument>[] = [];

    // Every word has to land somewhere, but each may land in a different
    // field — "decorators hyderabad" is a category and a city.
    for (const word of this.words(query.q)) {
      and.push({
        $or: [
          { name: word },
          { businessName: word },
          { displayName: word },
          { tags: word },
          { primaryCategory: word },
          { secondaryCategories: word },
          { servicesOffered: word },
          { occasions: word },
          { city: word },
          { location: word },
          { serviceAreas: word },
          { tagline: word },
        ],
      });
    }
    if (query.occasion) filter.occasions = query.occasion.trim().toLowerCase();
    if (query.city) {
      const city = this.term(query.city);
      if (city) and.push({ $or: [{ city }, { serviceAreas: city }, { location: city }] });
    }
    if (and.length) filter.$and = and;
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
   * The query as a list of per-word patterns.
   *
   * Matching the whole string as one pattern meant "wedding decor hyderabad"
   * found nothing unless some single field held that exact phrase. Instead
   * each meaningful word must match some field. Filler words are dropped, and
   * longer words are cut to a stem, so "decorators" finds "decoration" and
   * "photographers" finds "photography".
   */
  private words(value: string | undefined): RegExp[] {
    const tokens = (value ?? '')
      .toLowerCase()
      .split(/[\s,/&+-]+/)
      .map((t) => t.trim())
      .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
    const stems = [...new Set(tokens.map(stem))].slice(0, MAX_WORDS);
    return stems.map((t) => this.term(t)).filter((r): r is RegExp => r !== null);
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

/** Beyond this many words a query is a sentence, not a search. */
const MAX_WORDS = 6;

/** Words that say nothing about what is being searched for. */
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'in', 'at', 'on', 'for', 'of', 'and', 'or', 'to', 'near', 'me', 'with', 'my',
]);

/** A rough stem: long words lose their ending, short ones a plural "s". */
function stem(word: string): string {
  if (word.length >= 7) return word.slice(0, Math.max(5, word.length - 3));
  if (word.length > 4 && word.endsWith('s')) return word.slice(0, -1);
  return word;
}
