import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { OrganizerService } from '../organizer/organizer.service';
import { OrganizerProfileDocument } from '../organizer/schemas/organizer-profile.schema';
import {
  PlanServiceCategory,
  PlanServiceCategoryDocument,
} from './schemas/plan-service-category.schema';
import type { RecommendationSort } from './dto/recommendation-query.dto';

export interface RecommendationContext {
  categories: string[];
  occasion?: string;
  guests?: string;
  city?: string;
  area?: string;
  budget?: string;
  eventDate?: string;
  venue?: 'indoor' | 'outdoor';
  // Filters
  minRating?: number;
  tiers?: string[];
  requireCategories?: string[];
  maxPrice?: number;
  availableOnly?: boolean;
  // Sort
  sort?: RecommendationSort;
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
  matches: number; // covered service count
  total: number; // requested service count
  estRange: string; // dynamic estimate range
  estMin: number;
  estMax: number;
  available: boolean;
  responseHours: number;
  reasons: string[];
  score: number;
  // True for Evently's own concierge fallback (always shown last).
  concierge: boolean;
}

/**
 * Weighted, data-driven scoring factors. These are the algorithm's weights (not
 * per-organizer scores) — every factor's input is read from MongoDB. Weights sum
 * to 100 so the final score reads as a 0–100 relevance percentage.
 */
const WEIGHTS = {
  category: 28,
  budget: 14,
  capacity: 12,
  location: 10,
  occasion: 9,
  availability: 8,
  rating: 8,
  events: 5,
  response: 4,
  badge: 2,
} as const;

const TIER_BONUS: Record<string, number> = { Platinum: 1, Gold: 0.6, Silver: 0.3, Bronze: 0.15 };
const PER_GUEST_KEYS = new Set(['food', 'water', 'catering']);
// Fallback flat price for a covered-but-unrated service (kept minimal; real
// prices come from each organizer's categoryRates in Mongo).
const DEFAULT_FLAT: Record<string, number> = {
  decoration: 55000,
  photography: 42000,
  music: 40000,
  priest: 15000,
  mehendi: 22000,
  transport: 30000,
};

function parseGuests(guests?: string): number | null {
  if (!guests) return null;
  const n = parseInt(guests.replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Parse a budget bucket label like "₹1L – 3L" / "Under ₹1L" / "₹10L+". */
function parseBudget(budget?: string): { min: number; max: number } | null {
  if (!budget) return null;
  const nums = Array.from(budget.matchAll(/(\d+(?:\.\d+)?)\s*(l|k)?/gi)).map((m) => {
    const val = parseFloat(m[1]!);
    const unit = (m[2] ?? '').toLowerCase();
    return unit === 'l' ? val * 100000 : unit === 'k' ? val * 1000 : val;
  });
  if (nums.length === 0) return null;
  const lower = budget.toLowerCase();
  if (lower.includes('under') || lower.includes('below')) return { min: 0, max: nums[0]! };
  if (budget.includes('+') || lower.includes('above')) return { min: nums[0]!, max: Infinity };
  if (nums.length >= 2) return { min: nums[0]!, max: nums[1]! };
  return { min: 0, max: nums[0]! };
}

function formatMoney(n: number): string {
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  if (n >= 1000) return `₹${Math.round(n / 1000)}K`;
  return `₹${Math.round(n)}`;
}

function titleCase(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/**
 * Recommendation engine for the Plan Event "find organizers" step. Scores the
 * real `organizer_profiles` collection against every customer input using a
 * weighted model, computes a dynamic price estimate, generates human reasons,
 * then applies server-side filters and sorting.
 */
@Injectable()
export class PlanService {
  constructor(
    private readonly organizerService: OrganizerService,
    @InjectModel(PlanServiceCategory.name)
    private readonly serviceCategoryModel: Model<PlanServiceCategoryDocument>,
  ) {}

  /** category-key → keywords, plus category-key → title, from Mongo. */
  private async categoryMeta(): Promise<{
    keywords: Record<string, string[]>;
    titles: Record<string, string>;
  }> {
    const cats = await this.serviceCategoryModel.find().exec();
    const keywords: Record<string, string[]> = {};
    const titles: Record<string, string> = {};
    for (const c of cats) {
      keywords[c.key] = c.keywords?.length ? c.keywords : [c.key.toLowerCase()];
      titles[c.key] = c.title;
    }
    return { keywords, titles };
  }

  /** Does the organizer cover a requested category (explicit rate or keyword/tag)? */
  private covers(
    o: OrganizerProfileDocument,
    cat: string,
    keywords: Record<string, string[]>,
  ): boolean {
    if (o.categoryRates?.some((r) => r.key === cat)) return true;
    const kws = keywords[cat] ?? [cat.toLowerCase()];
    const lowerTags = o.tags.map((t) => t.toLowerCase());
    return kws.some((kw) => lowerTags.some((tag) => tag.includes(kw)));
  }

  /** Dynamic price estimate from the organizer's pricing + selected services + guests. */
  private estimate(
    o: OrganizerProfileDocument,
    coveredCats: string[],
    guests: number | null,
  ): { min: number; max: number } {
    const heads = guests ?? (o.capacityMin || 100);
    let total = o.basePrice ?? 0;
    for (const cat of coveredCats) {
      const rate = o.categoryRates?.find((r) => r.key === cat);
      if (rate) {
        total += rate.perGuest ? rate.price * heads : rate.price;
      } else if (PER_GUEST_KEYS.has(cat)) {
        total += (o.pricePerGuest || 0) * heads;
      } else {
        total += DEFAULT_FLAT[cat] ?? 0;
      }
    }
    // If nothing selected yet, fall back to a base-package estimate.
    if (coveredCats.length === 0 && total === (o.basePrice ?? 0)) {
      total = (o.basePrice ?? 0) + (o.pricePerGuest || 0) * heads;
    }
    return { min: Math.round(total * 0.9), max: Math.round(total * 1.1) };
  }

  private isAvailable(o: OrganizerProfileDocument, eventDate?: string): boolean {
    if (!eventDate) return true;
    const target = new Date(eventDate);
    if (Number.isNaN(target.getTime())) return true;
    const day = target.toISOString().slice(0, 10);
    return !(o.busyDates ?? []).some((d) => new Date(d).toISOString().slice(0, 10) === day);
  }

  private locationScore(o: OrganizerProfileDocument, city?: string, area?: string): number {
    const areaL = area?.trim().toLowerCase();
    const cityL = city?.trim().toLowerCase();
    const areas = (o.serviceAreas ?? []).map((a) => a.toLowerCase());
    const base = o.location.toLowerCase();
    if (
      areaL &&
      (areas.some((a) => a.includes(areaL) || areaL.includes(a)) || base.includes(areaL))
    ) {
      return 1;
    }
    if (cityL && (areas.some((a) => a.includes(cityL)) || base.includes(cityL))) return 0.6;
    if (!areaL && !cityL) return 0.5;
    return 0.2;
  }

  async recommend(ctx: RecommendationContext): Promise<MatchedOrganizer[]> {
    const [organizers, meta] = await Promise.all([
      this.organizerService.findAllActive(),
      this.categoryMeta(),
    ]);

    const guests = parseGuests(ctx.guests);
    const budget = parseBudget(ctx.budget);
    const total = ctx.categories.length;
    const occasion = ctx.occasion?.trim().toLowerCase();
    const occasionLabel = titleCase(ctx.occasion ?? '');
    const dateLabel = ctx.eventDate
      ? new Date(ctx.eventDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
      : '';

    let scored = organizers.map((o) => {
      const covered = ctx.categories.filter((c) => this.covers(o, c, meta.keywords));
      const est = this.estimate(o, covered, guests);
      const available = this.isAvailable(o, ctx.eventDate);
      const locScore = this.locationScore(o, ctx.city, ctx.area);

      // ---- Factor scores (0..1) ----
      const fCategory = total > 0 ? covered.length / total : 1;
      const fBudget = !budget
        ? 0.7
        : est.max <= budget.max
          ? 1
          : est.min > budget.max * 1.25
            ? 0.25
            : 0.6;
      const fCapacity = !guests
        ? 0.8
        : guests > o.capacityMax
          ? 0.2
          : guests < o.capacityMin
            ? 0.7
            : 1;
      const fLocation = locScore;
      const fOccasion = !occasion ? 0.6 : (o.occasions ?? []).includes(occasion) ? 1 : 0.4;
      const fAvailability = available ? 1 : 0;
      const fRating = clamp01((o.rating ?? 0) / 5);
      const fEvents = clamp01((o.events ?? 0) / 300);
      const fResponse = clamp01((o.responseRate ?? 0) / 100);
      const fBadge = TIER_BONUS[o.tier] ?? 0.2;

      const score =
        fCategory * WEIGHTS.category +
        fBudget * WEIGHTS.budget +
        fCapacity * WEIGHTS.capacity +
        fLocation * WEIGHTS.location +
        fOccasion * WEIGHTS.occasion +
        fAvailability * WEIGHTS.availability +
        fRating * WEIGHTS.rating +
        fEvents * WEIGHTS.events +
        fResponse * WEIGHTS.response +
        fBadge * WEIGHTS.badge;

      const reasons = this.buildReasons({
        o,
        covered,
        total,
        titles: meta.titles,
        budget,
        budgetLabel: ctx.budget,
        est,
        guests,
        available,
        dateLabel,
        occasion,
        occasionLabel,
        fLocation,
        area: ctx.area,
        city: ctx.city,
      });

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
        matches: covered.length,
        total,
        estRange: `${formatMoney(est.min)} – ${formatMoney(est.max)}`,
        estMin: est.min,
        estMax: est.max,
        available,
        responseHours: o.responseHours ?? 24,
        reasons,
        score: Math.round(score),
        concierge: !!o.concierge,
      };
      return { view, o, locScore };
    });

    // Evently's concierge is a guaranteed fallback — always shown (after real
    // matches), never subject to the filters below, so the list is never empty.
    const conciergeItems = scored.filter((s) => s.o.concierge);
    scored = scored.filter((s) => !s.o.concierge);

    // ---- Server-side filters (real organizers only) ----
    if (ctx.minRating) scored = scored.filter((s) => s.view.rating >= ctx.minRating!);
    if (ctx.tiers?.length) scored = scored.filter((s) => ctx.tiers!.includes(s.view.tier));
    if (ctx.maxPrice) scored = scored.filter((s) => s.view.estMin <= ctx.maxPrice!);
    if (ctx.availableOnly) scored = scored.filter((s) => s.view.available);
    if (ctx.venue) {
      scored = scored.filter((s) => (ctx.venue === 'indoor' ? s.o.indoor : s.o.outdoor));
    }
    if (ctx.requireCategories?.length) {
      scored = scored.filter((s) =>
        ctx.requireCategories!.every((c) => this.covers(s.o, c, meta.keywords)),
      );
    }

    // ---- Server-side sort ----
    const sort = ctx.sort ?? 'best';
    scored.sort((a, b) => {
      switch (sort) {
        case 'rating':
          return b.view.rating - a.view.rating;
        case 'price':
          return a.view.estMin - b.view.estMin;
        case 'events':
          return b.view.events - a.view.events;
        case 'response':
          return a.view.responseHours - b.view.responseHours;
        case 'nearest':
          return b.locScore - a.locScore || b.view.score - a.view.score;
        default:
          return b.view.score - a.view.score;
      }
    });

    // Concierge fallback: lead reason explains the Evently-managed offer, then
    // appended after the real matches (or as the only option when none matched).
    for (const c of conciergeItems) {
      c.view.reasons = [
        'Evently plans & manages your whole event',
        ...c.view.reasons.filter((r) => !r.startsWith('Covers')),
      ].slice(0, 6);
    }

    return [...scored.map((s) => s.view), ...conciergeItems.map((s) => s.view)];
  }

  /** Generates specific, data-derived reasons (strongest first, capped). */
  private buildReasons(a: {
    o: OrganizerProfileDocument;
    covered: string[];
    total: number;
    titles: Record<string, string>;
    budget: { min: number; max: number } | null;
    budgetLabel?: string;
    est: { min: number; max: number };
    guests: number | null;
    available: boolean;
    dateLabel: string;
    occasion?: string;
    occasionLabel: string;
    fLocation: number;
    area?: string;
    city?: string;
  }): string[] {
    const reasons: string[] = [];
    const { o } = a;

    // Category coverage — specific, not "matches N of M".
    if (a.total > 0) {
      if (a.covered.length === a.total) {
        reasons.push(`Covers all ${a.total} services you need`);
      } else if (a.covered.length > 0) {
        const coveredTitles = a.covered
          .map((c) => a.titles[c] ?? c)
          .slice(0, 3)
          .join(', ');
        reasons.push(
          `Covers ${a.covered.length} of your ${a.total} services${coveredTitles ? ` (${coveredTitles})` : ''}`,
        );
      }
    }

    // Budget fit.
    if (a.budget && a.est.max <= a.budget.max && a.budgetLabel) {
      reasons.push(`Fits your ${a.budgetLabel} budget`);
    }

    // Availability.
    if (a.dateLabel && a.available) reasons.push(`Available on ${a.dateLabel}`);

    // Capacity.
    if (a.guests && a.guests <= o.capacityMax && a.guests >= o.capacityMin) {
      reasons.push(`Comfortably handles ${a.guests} guests`);
    } else if (a.guests && a.guests <= o.capacityMax) {
      reasons.push(`Handles up to ${o.capacityMax} guests`);
    }

    // Occasion specialism.
    if (a.occasion && (o.occasions ?? []).includes(a.occasion)) {
      reasons.push(`${a.occasionLabel} specialist`);
    }

    // Location.
    if (a.fLocation >= 1 && a.area) reasons.push(`Serves ${a.area}`);
    else if (a.fLocation >= 0.6 && a.city) reasons.push(`Serves ${a.city}`);

    // Track record.
    if (o.events > 0) {
      const suffix =
        a.occasion && (o.occasions ?? []).includes(a.occasion)
          ? `${a.occasionLabel.toLowerCase()} events`
          : 'events delivered';
      reasons.push(`${o.events}+ ${suffix}`);
    }

    // Rating.
    if (o.rating > 0) reasons.push(`${o.rating}★ from ${o.reviews} reviews`);

    // Responsiveness.
    if (o.responseHours && o.responseHours <= 6) reasons.push(`Replies within ${o.responseHours}h`);
    else if (o.responseRate >= 90) reasons.push(`${o.responseRate}% response rate`);

    // Badge (small bonus, last).
    if (o.tier === 'Platinum' || o.tier === 'Gold') reasons.push(`${o.tier}-tier verified`);

    return reasons.slice(0, 6);
  }
}
