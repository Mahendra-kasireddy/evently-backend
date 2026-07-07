import { Injectable } from '@nestjs/common';
import { ContentService } from '../content/content.service';
import { OrganizerService } from '../organizer/organizer.service';

export const CUSTOMER_PLAN_KEY = 'customer-plan';

/** Maps a plan category id to keywords used to test an organizer's service tags. */
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  food: ['catering', 'food', 'full service'],
  water: ['water', 'catering', 'full service'],
  decoration: ['decor', 'decoration', 'full service'],
  photography: ['photo', 'photography', 'full service'],
  music: ['music', 'sound', 'dj', 'full service'],
  priest: ['priest', 'pandit', 'full service'],
  mehendi: ['mehendi', 'full service'],
  transport: ['transport', 'travel', 'full service'],
};

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
 * Plan Event screen module (BFF). Serves the wizard copy from content and the
 * matched-organizers list from the real organizer_profiles collection.
 */
@Injectable()
export class PlanService {
  constructor(
    private readonly contentService: ContentService,
    private readonly organizerService: OrganizerService,
  ) {}

  getPlanScreen() {
    return this.contentService.getData(CUSTOMER_PLAN_KEY);
  }

  /** Real organizers scored against the user's selected categories. */
  async getOrganizers(categoryIds: string[]): Promise<MatchedOrganizer[]> {
    const organizers = await this.organizerService.findAllActive();
    const total = categoryIds.length;

    return organizers.map((o) => {
      const lowerTags = o.tags.map((t) => t.toLowerCase());
      const matches = categoryIds.filter((cat) => {
        const keywords = CATEGORY_KEYWORDS[cat] ?? [cat.toLowerCase()];
        return keywords.some((kw) => lowerTags.some((tag) => tag.includes(kw)));
      }).length;

      return {
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
    });
  }
}
