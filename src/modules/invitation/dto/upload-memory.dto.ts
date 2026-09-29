import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { MEMORY_CAPTION_MAX } from '../memories/memory.constants';

/**
 * What a guest says about the file they are adding.
 *
 * Everything here is a claim: it arrives as multipart form fields beside the
 * file, so the numbers are coerced and the sub-event is checked against the
 * ones this guest may actually see before any of it is honoured.
 */
export class UploadMemoryDto {
  /** Which celebration. Authoritative when it names one they can see. */
  @IsOptional()
  @IsMongoId()
  subEventId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MEMORY_CAPTION_MAX)
  caption?: string;

  /**
   * Seconds, measured by the client before upload.
   *
   * The backend has no decoder, so this cannot be verified here — it is
   * clamped and bounded instead, and the worst a wrong value does is put a
   * clip in the other tab.
   */
  @IsOptional()
  @Transform(({ value }) => (value === undefined || value === '' ? undefined : Number(value)))
  @IsNumber()
  @Min(0)
  durationSec?: number;

  /** Whether the guest recorded this as a reel. */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  reel?: boolean;
}
