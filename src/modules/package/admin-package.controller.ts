import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { PackageService } from './package.service';
import { SetPackagePhotoDto } from './dto/set-package-photo.dto';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { StoredFile } from '../organizer/schemas/organizer-profile.schema';

/**
 * Packages, as the admin console manages them.
 *
 * Admins can photograph any package, including one an organizer owns — the
 * same oversight shape as coupons, where an admin can disable an organizer's
 * coupon without being able to create one in their name. Authorization is the
 * class-level guard, as on every other admin surface.
 */
@Controller('admin/package')
@UseGuards(RolesGuard)
@Roles(Role.ADMIN)
export class AdminPackageController {
  constructor(private readonly packageService: PackageService) {}

  /** Every package, active or not, so an admin can see what needs a photo. */
  @Get('getPackages')
  getPackages() {
    return this.packageService.listAllForAdmin();
  }

  @Patch(':id/photo')
  setPhoto(@Param('id') id: string, @Body() dto: SetPackagePhotoDto) {
    return this.packageService.setPhotoAsAdmin(id, (dto.photo as StoredFile | undefined) ?? null);
  }
}
