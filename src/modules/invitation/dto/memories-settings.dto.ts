import { IsBoolean, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';

/**
 * Shared Memories, as its owner changes it.
 *
 * Only the customer reaches this. There is no organizer equivalent, and that
 * is deliberate rather than pending: the gallery is the customer's guests
 * photographing the customer's celebration.
 */
export class MemoriesSettingsDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsBoolean()
  guestUpload?: boolean;

  @IsOptional()
  @IsBoolean()
  guestView?: boolean;

  @IsOptional()
  @IsBoolean()
  guestDownload?: boolean;

  @IsOptional()
  @IsBoolean()
  moderation?: boolean;

  /** `yyyy-mm-dd`, or '' to open as soon as the feature is on. */
  @IsOptional()
  @Matches(/^(\d{4}-\d{2}-\d{2})?$/, { message: 'uploadFrom must be yyyy-mm-dd' })
  uploadFrom?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  uploadWindowDays?: number;
}
