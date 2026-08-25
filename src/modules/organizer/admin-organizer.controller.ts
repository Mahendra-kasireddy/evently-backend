import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { AdminOrganizerService } from './admin-organizer.service';
import { ListOrganizersDto } from './dto/list-organizers.dto';
import { ReviewDecisionDto } from './dto/review-decision.dto';
import { AdminUpdateOnboardingDto } from './dto/admin-update-onboarding.dto';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

/**
 * Admin-only organizer management.
 *
 * The class-level @Roles(Role.ADMIN) + RolesGuard is the authorization — it
 * runs on every route here, so a customer or an organizer calling these URLs
 * directly gets 403 no matter what any client renders. The admin console's own
 * role check is convenience on top of this, never a substitute for it.
 *
 * These endpoints read and write the same organizer_profiles documents the
 * organizer app uses. There is no second organizer record anywhere.
 */
@Controller('admin/organizer')
@UseGuards(RolesGuard)
@Roles(Role.ADMIN)
export class AdminOrganizerController {
  constructor(private readonly adminOrganizerService: AdminOrganizerService) {}

  /** Paginated, searchable, status-filtered list of self-registered organizers. */
  @Get('getOrganizers')
  getOrganizers(@Query() query: ListOrganizersDto) {
    return this.adminOrganizerService.list(query);
  }

  /** Real per-status counts for the filter chips. */
  @Get('getStatusCounts')
  getStatusCounts() {
    return this.adminOrganizerService.counts();
  }

  /** Full organizer record: account, onboarding, step completion, review trail. */
  @Get('getOrganizerById/:id')
  getOrganizerById(@Param('id') id: string) {
    return this.adminOrganizerService.detail(id);
  }

  /**
   * Gate 1 from pending_review, gate 2 from submitted. The service decides
   * which by the organizer's current state; invalid states are refused.
   */
  @HttpCode(HttpStatus.OK)
  @Post('approveOrganizer/:id')
  approveOrganizer(@Param('id') id: string, @CurrentUser('userId') adminId: string) {
    return this.adminOrganizerService.approve(id, adminId);
  }

  @HttpCode(HttpStatus.OK)
  @Post('rejectOrganizer/:id')
  rejectOrganizer(
    @Param('id') id: string,
    @CurrentUser('userId') adminId: string,
    @Body() dto: ReviewDecisionDto,
  ) {
    return this.adminOrganizerService.reject(id, adminId, dto.reason);
  }

  @HttpCode(HttpStatus.OK)
  @Post('requestChanges/:id')
  requestChanges(
    @Param('id') id: string,
    @CurrentUser('userId') adminId: string,
    @Body() dto: ReviewDecisionDto,
  ) {
    return this.adminOrganizerService.requestChanges(id, adminId, dto.reason);
  }

  /** Fills in onboarding fields on the organizer's behalf, attributed to the admin. */
  @Patch('updateOnboarding/:id')
  updateOnboarding(
    @Param('id') id: string,
    @CurrentUser('userId') adminId: string,
    @Body() dto: AdminUpdateOnboardingDto,
  ) {
    return this.adminOrganizerService.updateOnboarding(id, adminId, dto);
  }
}
