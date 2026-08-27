import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { AdminUserService } from './admin-user.service';
import { ListUsersDto } from './dto/list-users.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

/**
 * Admin-only account management.
 *
 * The class-level @Roles(Role.ADMIN) + RolesGuard is the authorization, the
 * same mechanism AdminOrganizerController and AdminContactController use: it
 * runs on every route here, so a customer hitting these URLs directly gets 403
 * whatever the console renders.
 */
@Controller('admin/user')
@UseGuards(RolesGuard)
@Roles(Role.ADMIN)
export class AdminUserController {
  constructor(private readonly adminUserService: AdminUserService) {}

  /** Paginated, searchable, role- and status-filtered list of accounts. */
  @Get('getUsers')
  getUsers(@Query() query: ListUsersDto) {
    return this.adminUserService.list(query);
  }

  /** Real per-status and per-role counts for the filter chips. */
  @Get('getStatusCounts')
  getStatusCounts() {
    return this.adminUserService.counts();
  }

  /** One account plus its real booking / quote / plan activity. */
  @Get('getUserById/:id')
  getUserById(@Param('id') id: string) {
    return this.adminUserService.detail(id);
  }

  /** Suspend or reactivate. Suspending also revokes the account's session. */
  @Patch('updateStatus/:id')
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateUserStatusDto,
    @CurrentUser('userId') actingAdminId: string,
  ) {
    return this.adminUserService.setStatus(id, dto.status, actingAdminId);
  }
}
