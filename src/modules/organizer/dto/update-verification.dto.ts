import { Type } from 'class-transformer';
import { IsOptional, IsString, Matches, MaxLength, ValidateNested } from 'class-validator';
import { StoredFileDto } from './stored-file.dto';

// Indian identifier formats.
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const AADHAAR_RE = /^[2-9][0-9]{11}$/;
const GST_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/**
 * Step 2 (Verification) update. All fields optional for autosave; the required
 * set is enforced at submission time. Values are normalized (uppercased) on the
 * schema. Unknown fields are stripped by the global ValidationPipe.
 */
export class UpdateVerificationDto {
  @IsOptional()
  @IsString()
  @Matches(AADHAAR_RE, { message: 'Enter a valid 12-digit Aadhaar number' })
  aadhaarNumber?: string;

  @IsOptional()
  @IsString()
  @Matches(PAN_RE, { message: 'Enter a valid PAN (e.g. ABCDE1234F)' })
  panNumber?: string;

  @IsOptional()
  @IsString()
  @Matches(GST_RE, { message: 'Enter a valid 15-character GSTIN' })
  gstNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  businessRegNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  governmentIdType?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => StoredFileDto)
  governmentIdFile?: StoredFileDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => StoredFileDto)
  panFile?: StoredFileDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => StoredFileDto)
  gstFile?: StoredFileDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => StoredFileDto)
  businessRegFile?: StoredFileDto;
}
