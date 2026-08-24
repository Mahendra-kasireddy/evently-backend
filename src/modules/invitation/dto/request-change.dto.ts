import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** A customer asking the organizer to change a section they don't own. */
export class RequestChangeDto {
  /** Omitted when the ask is about the invitation as a whole. */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  blockKey?: string;

  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  note: string;
}
