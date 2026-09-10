import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

/** What kinds of result the caller wants back. */
export const SEARCH_KINDS = ['all', 'packages', 'organizers'] as const;
export type SearchKind = (typeof SEARCH_KINDS)[number];

/**
 * A customer search.
 *
 * Everything is optional: an empty query with a city filter is a legitimate
 * "show me what is available near me". `q` is bounded and escaped downstream
 * before it reaches a regex — an unbounded pattern from a client is a denial
 * of service waiting to happen, not just a bad search.
 */
export class SearchQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  occasion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  city?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minBudget?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxBudget?: number;

  @IsOptional()
  @IsIn(SEARCH_KINDS)
  kind?: SearchKind;
}
