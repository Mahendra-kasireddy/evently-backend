import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * The organizer's summary of the event. Every field is optional so a slot can
 * be filled in as it becomes clear, and an empty string deliberately clears one
 * back to "not captured yet".
 */
export class UpdateVisionDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  theme?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  vibe?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  surprise?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  food?: string;

  @IsOptional()
  @IsBoolean()
  surpriseConfidential?: boolean;
}
