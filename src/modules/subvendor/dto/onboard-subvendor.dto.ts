import {
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { Type } from 'class-transformer';
import { SubVendorCategory } from '../schemas/subvendor-profile.schema';

export class OnboardSubvendorDto {
  @IsString()
  @MinLength(1)
  fullName: string;

  @IsEnum(SubVendorCategory)
  categoryId: SubVendorCategory;

  /**
   * Required only when the vendor picked "Other" — there is no point storing a
   * category of "other" with nothing to say what it actually is. Ignored for
   * every other category, so a stale value can't linger on the profile.
   */
  @ValidateIf((o: OnboardSubvendorDto) => o.categoryId === SubVendorCategory.OTHER)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2, { message: 'Tell us what you do, in a couple of words' })
  @MaxLength(60, { message: 'Keep it under 60 characters' })
  customCategory?: string;

  @IsOptional()
  @IsString()
  serviceArea?: string;

  @IsOptional()
  @Type(() => Number)
  @Min(0)
  baseRate?: number;

  @IsOptional()
  @Type(() => Number)
  @Min(0)
  minOrder?: number;

  // Optional — links straight to that organizer during signup (LinkStep).
  @IsOptional()
  @IsString()
  @Matches(/^\d{10}$/, { message: 'Enter a valid 10-digit mobile number' })
  organizerPhone?: string;
}

export class InviteSubvendorDto {
  @IsString()
  @Matches(/^\d{10}$/, { message: 'Enter a valid 10-digit mobile number' })
  phone: string;
}

export class RateSubvendorDto {
  @Type(() => Number)
  @Min(1)
  @Max(5)
  rating: number;
}
