import { Type } from 'class-transformer';
import { IsOptional, ValidateNested } from 'class-validator';
import { StoredFileDto } from '../../organizer/dto/stored-file.dto';

/**
 * The picture to put on an occasion or service-category tile.
 *
 * Only the file. Which tile it belongs to is the route parameter, so it cannot
 * be supplied in the body, and the global ValidationPipe's `whitelist: true`
 * strips anything else sent alongside.
 *
 * `image` omitted (or null) clears the picture, which is how a tile goes back
 * to its illustration.
 */
export class SetTileImageDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => StoredFileDto)
  image?: StoredFileDto | null;
}
