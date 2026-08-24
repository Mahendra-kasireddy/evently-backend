import { IsEnum, IsOptional, IsString, Matches, Max, Min, MinLength } from 'class-validator';
import { Type } from 'class-transformer';
import { SubVendorCategory } from '../schemas/subvendor-profile.schema';

export class OnboardSubvendorDto {
  @IsString()
  @MinLength(1)
  fullName: string;

  @IsEnum(SubVendorCategory)
  categoryId: SubVendorCategory;

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
