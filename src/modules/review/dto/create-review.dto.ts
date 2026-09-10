import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ReviewTag } from '../schemas/review.schema';

/**
 * What a customer may set on their review.
 *
 * Note what is absent: no organizer, no customer, no occasion, no date. All
 * four are read from the booking server-side. Accepting an organizer id here
 * would let anyone attach a five-star review to any organizer, and accepting a
 * customer id would let them write one as somebody else — the omission is the
 * access control, exactly as on UpdateProfileDto.
 */
export class CreateReviewDto {
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @IsEnum(ReviewTag, { each: true })
  tags?: ReviewTag[];
}
