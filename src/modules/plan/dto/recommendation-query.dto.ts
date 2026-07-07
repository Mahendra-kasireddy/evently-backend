import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Context used to score organizer recommendations for a plan. Everything is
 * optional — with no context the scorer returns all active organizers unscored.
 */
export class RecommendationQueryDto {
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
}
