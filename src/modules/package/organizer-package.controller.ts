import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { PackageService } from './package.service';
import { SetPackagePhotoDto } from './dto/set-package-photo.dto';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { StoredFile } from '../organizer/schemas/organizer-profile.schema';

/**
 * An organizer's own packages.
 *
 * The organizer is never a parameter, exactly as on the coupon surface: every
 * route resolves the profile from the session, so there is no request in which
 * an organizer id could be supplied. `SetPackagePhotoDto` declares only
 * `photo`, and the global ValidationPipe runs with `whitelist: true`, so an
 * `organizer` smuggled into the body is stripped before the service is reached.
 *
 * Ownership is then checked against the package itself — belonging to somebody
 * else is a 404, not a 403, so ids cannot be probed for existence.
 */
@Controller('package/organizer')
@UseGuards(RolesGuard)
@Roles(Role.ORGANIZER, Role.ADMIN)
export class OrganizerPackageController {
  constructor(private readonly packageService: PackageService) {}

  @Get('mine')
  mine(@CurrentUser('userId') userId: string) {
    return this.packageService.listForOrganizer(userId);
  }

  /**
   * Sets the banner photo, or clears it by sending no `photo`.
   *
   * The file itself goes to POST /upload with purpose `packagePhoto` first;
   * this attaches the metadata that call returns. Splitting the two is how
   * every other asset in this app is stored, and it keeps the size and
   * dimension rules in one place — the upload service — rather than repeated
   * per feature.
   */
  @Patch(':id/photo')
  setPhoto(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
    @Body() dto: SetPackagePhotoDto,
  ) {
    return this.packageService.setPhotoForOrganizer(
      userId,
      id,
      (dto.photo as StoredFile | undefined) ?? null,
    );
  }
}
