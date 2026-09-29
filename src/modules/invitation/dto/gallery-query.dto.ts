import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { MediaKind } from '../memories/memory.constants';

/** Which tab, which celebration, and where the last page stopped. */
export class GalleryQueryDto {
  @IsOptional()
  @IsIn(['all', MediaKind.PHOTO, MediaKind.VIDEO, MediaKind.REEL])
  kind?: string;

  /** A sub-event id, or 'all'. Checked against this guest's own list. */
  @IsOptional()
  @IsString()
  subEvent?: string;

  @IsOptional()
  @Transform(({ value }) => (value === undefined || value === '' ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  @Max(60)
  limit?: number;

  /** The `createdAt` of the last item on the previous page, as ISO. */
  @IsOptional()
  @IsString()
  before?: string;
}
