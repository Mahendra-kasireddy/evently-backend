import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/; // HH:mm 24h

/** Step 4 (Services) update. All fields optional for autosave. */
export class UpdateServicesDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  experience?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  teamSize?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  languages?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  secondaryCategories?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  servicesOffered?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  occasions?: string[];

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(5000)
  serviceRadius?: number;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  travelOption?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  paymentMethods?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  workingDays?: string[];

  @IsOptional()
  @IsString()
  @Matches(TIME_RE, { message: 'Working hours must be HH:mm' })
  workingHoursStart?: string;

  @IsOptional()
  @IsString()
  @Matches(TIME_RE, { message: 'Working hours must be HH:mm' })
  workingHoursEnd?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  minBudget?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  maxBudget?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  advancePercentage?: number;

  @IsOptional()
  @IsBoolean()
  emergencyAvailability?: boolean;

  @IsOptional()
  @IsBoolean()
  destinationEvents?: boolean;

  @IsOptional()
  @IsBoolean()
  internationalEvents?: boolean;
}
