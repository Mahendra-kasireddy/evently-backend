import { Type } from 'class-transformer';
import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { StoredFileDto } from './stored-file.dto';

/**
 * Step 1 (Basic Information) update. Every field is optional so the client can
 * autosave partial drafts; `complete-onboarding` enforces the required set.
 * Unknown fields are stripped by the global ValidationPipe (whitelist:true).
 */
export class UpdateOrganizerProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  lastName?: string;

  @IsOptional()
  @IsEmail({}, { message: 'Enter a valid email' })
  @MaxLength(120)
  contactEmail?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  businessName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  displayName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  businessType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  primaryCategory?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  city?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => StoredFileDto)
  profilePhoto?: StoredFileDto;
}
