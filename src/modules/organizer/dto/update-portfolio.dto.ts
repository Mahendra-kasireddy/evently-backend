import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { StoredFileDto } from './stored-file.dto';

const URL_OPTS = { require_protocol: false, require_tld: true } as const;

/** Step 5 (Portfolio) update. All fields optional for autosave. */
export class UpdatePortfolioDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  tagline?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  businessDescription?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(80)
  yearsOfExperience?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(160, { each: true })
  featuredProjects?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(200)
  instagram?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  facebook?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  youtube?: string;

  @IsOptional()
  @IsUrl(URL_OPTS, { message: 'Enter a valid website URL' })
  @MaxLength(200)
  website?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  linkedin?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => StoredFileDto)
  coverPhoto?: StoredFileDto;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StoredFileDto)
  gallery?: StoredFileDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StoredFileDto)
  videos?: StoredFileDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StoredFileDto)
  certificates?: StoredFileDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StoredFileDto)
  awards?: StoredFileDto[];
}
