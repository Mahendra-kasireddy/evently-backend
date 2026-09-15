import { Type } from 'class-transformer';
import { IsOptional, ValidateNested } from 'class-validator';
import { StoredFileDto } from '../../organizer/dto/stored-file.dto';

/**
 * The banner photo to put on a package card.
 *
 * Only the file. There is deliberately no `organizer` and no `packageId` here:
 * the package is the route parameter, and who owns it is read from the session,
 * so neither can be supplied by a caller. The global ValidationPipe runs with
 * `whitelist: true`, so anything else sent in this body is stripped before the
 * service sees it.
 *
 * `photo` omitted (or null) clears the picture, which is how a package goes
 * back to its occasion illustration.
 */
export class SetPackagePhotoDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => StoredFileDto)
  photo?: StoredFileDto | null;
}
