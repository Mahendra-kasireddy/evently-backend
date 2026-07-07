import { Type } from 'class-transformer';
import { ArrayUnique, IsArray, IsDate, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Payload for saving a draft or creating/updating a plan. All fields optional so
 * a partial draft can be persisted as the customer moves through the wizard.
 */
export class UpsertPlanDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  occasion?: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  eventDate?: Date;

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
  @MaxLength(20)
  guests?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  ideas?: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  categories?: string[];
}
