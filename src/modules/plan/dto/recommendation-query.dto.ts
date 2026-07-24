import { Type } from 'class-transformer';
import {
  IsBooleanString,
  IsIn,
  IsNumberString,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export const RECOMMENDATION_SORTS = [
  'best',
  'rating',
  'price',
  'events',
  'response',
  'nearest',
] as const;
export type RecommendationSort = (typeof RECOMMENDATION_SORTS)[number];

/**
 * Context + filters used to score and order organizer recommendations. Everything
 * is optional — with no context the scorer returns all active organizers.
 */
export class RecommendationQueryDto {
  // ----- Plan context (all customer inputs) -----

  // Comma-separated service-category keys, e.g. "food,decoration,photography".
  @IsOptional()
  @IsString()
  @MaxLength(300)
  categories?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  occasion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  guests?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  area?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  budget?: string;

  // ISO date string of the event, e.g. "2026-12-28".
  @IsOptional()
  @IsString()
  @MaxLength(40)
  eventDate?: string;

  @IsOptional()
  @IsIn(['indoor', 'outdoor'])
  venue?: 'indoor' | 'outdoor';

  // ----- Filters (applied server-side) -----

  @IsOptional()
  @IsNumberString()
  minRating?: string;

  // Comma-separated tier names to keep, e.g. "Gold,Platinum".
  @IsOptional()
  @IsString()
  @MaxLength(120)
  tiers?: string;

  // Comma-separated category keys the organizer must cover.
  @IsOptional()
  @IsString()
  @MaxLength(300)
  requireCategories?: string;

  @IsOptional()
  @IsNumberString()
  maxPrice?: string;

  @IsOptional()
  @IsBooleanString()
  availableOnly?: string;

  // ----- Sort -----

  @IsOptional()
  @IsIn(RECOMMENDATION_SORTS as unknown as string[])
  @Type(() => String)
  sort?: RecommendationSort;
}
