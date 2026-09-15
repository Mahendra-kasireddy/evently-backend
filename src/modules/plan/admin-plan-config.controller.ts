import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { PlanConfigService } from './plan-config.service';
import { SetTileImageDto } from './dto/set-tile-image.dto';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { StoredFile } from '../organizer/schemas/organizer-profile.schema';

/**
 * The pictures on occasion and service-category tiles.
 *
 * Admin-only, because these are platform furniture rather than anybody's own
 * content: one photograph on the "Wedding" tile is seen by every customer, and
 * there is no organizer who owns it to scope the write to.
 *
 * Both entities are addressed by their natural key ("wedding", "photography")
 * rather than an ObjectId — that is the identifier the seed writes, the client
 * consumes and an admin recognises.
 */
@Controller('admin/plan-config')
@UseGuards(RolesGuard)
@Roles(Role.ADMIN)
export class AdminPlanConfigController {
  constructor(private readonly planConfigService: PlanConfigService) {}

  /** Every occasion and category, active or not, with its current picture. */
  @Get('tiles')
  tiles() {
    return this.planConfigService.listTilesForAdmin();
  }

  /**
   * Sets the picture, or clears it by sending no `image`.
   *
   * The file goes to POST /upload with purpose `categoryImage` first; this
   * attaches the metadata that returns, so the size and dimension rules stay
   * in the upload service rather than being restated here.
   */
  @Patch('occasion/:key/image')
  setOccasionImage(@Param('key') key: string, @Body() dto: SetTileImageDto) {
    return this.planConfigService.setOccasionImage(
      key,
      (dto.image as StoredFile | undefined) ?? null,
    );
  }

  @Patch('category/:key/image')
  setCategoryImage(@Param('key') key: string, @Body() dto: SetTileImageDto) {
    return this.planConfigService.setCategoryImage(
      key,
      (dto.image as StoredFile | undefined) ?? null,
    );
  }
}
