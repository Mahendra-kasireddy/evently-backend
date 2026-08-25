import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * A rejection or a changes-requested decision. The reason is mandatory: it is
 * shown to the organizer and stored in the review trail, so a decision without
 * one would leave both the organizer and the next admin guessing.
 */
export class ReviewDecisionDto {
  @IsString()
  @MinLength(5, { message: 'Give the organizer a reason (at least 5 characters)' })
  @MaxLength(2000)
  reason: string;
}
