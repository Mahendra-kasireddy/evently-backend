import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';

/** The support team's reply to one contact request. */
export class RespondContactRequestDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(5, { message: 'Write a response before sending it' })
  @MaxLength(5000)
  response: string;
}
