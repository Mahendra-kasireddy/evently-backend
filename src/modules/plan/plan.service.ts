import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { OrganizerService } from '../organizer/organizer.service';
import {
  PlanServiceCategory,
  PlanServiceCategoryDocument,
} from './schemas/plan-service-category.schema';

export interface RecommendationContext {
  categories: string[];
  occasion?: string;
  guests?: string;
  city?: string;
}

export interface MatchedOrganizer {
  id: string;
  initials: string;
  name: string;
  avatarColor: string;
  tier: string;
  rating: number;
  reviews: number;
  events: number;
  location: string;
  tags: string[];
  matches: number;
  total: number;
  estRange: string;
}

/**
 * Recommendation engine for the Plan Event "find organizers" step. Scores the
 * real `organizer_profiles` collection against the customer's selected service
 * categories (keyword-matched from `plan_service_categories`) plus soft signals
 * for city, then returns them ordered by relevance.
 */
@Injectable()
export class PlanService {
  constructor(
    private readonly organizerService: OrganizerService,
    @InjectModel(PlanServiceCategory.name)
    private readonly serviceCategoryModel: Model<PlanServiceCategoryDocument>,
  ) {}

  /** Builds a category-key → keywords lookup from the service-category collection. */
  private async keywordMap(): Promise<Record<string, string[]>> {
    const cats = await this.serviceCategoryModel.find().exec();
    const map: Record<string, string[]> = {};
    for (const c of cats) {
      map[c.key] = c.keywords?.length ? c.keywords : [c.key.toLowerCase()];
    }
    return map;
  }

  /** Real organizers scored against the plan context. */
  async recommend(ctx: RecommendationContext): Promise<MatchedOrganizer[]> {
    const [organizers, keywords] = await Promise.all([
      this.organizerService.findAllActive(),
      this.keywordMap(),
    ]);

    const total = ctx.categories.length;
    const city = ctx.city?.trim().toLowerCase();

    const scored = organizers.map((o) => {
      const lowerTags = o.tags.map((t) => t.toLowerCase());
      const matches = ctx.categories.filter((cat) => {
        const kws = keywords[cat] ?? [cat.toLowerCase()];
        return kws.some((kw) => lowerTags.some((tag) => tag.includes(kw)));
      }).length;

      // Soft relevance boost: same-city organizers surface first.
      const cityBoost = city && o.location.toLowerCase().includes(city) ? 1 : 0;

      const view: MatchedOrganizer = {
        id: o._id.toString(),
        initials: o.initials,
        name: o.name,
        avatarColor: o.avatarColor,
        tier: o.tier,
        rating: o.rating,
        reviews: o.reviews,
        events: o.events,
        location: o.location,
        tags: o.tags,
        matches,
        total,
        estRange: o.estRange,
      };
      return { view, score: matches * 10 + cityBoost * 3 + o.rating };
    });

    return scored.sort((a, b) => b.score - a.score).map((s) => s.view);
  }
}
