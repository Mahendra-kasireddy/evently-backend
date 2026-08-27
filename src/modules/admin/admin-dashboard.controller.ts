import { Controller, Get, UseGuards } from '@nestjs/common';
import { AdminDashboardService } from './admin-dashboard.service';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';

/** Admin-only console summary. */
@Controller('admin/dashboard')
@UseGuards(RolesGuard)
@Roles(Role.ADMIN)
export class AdminDashboardController {
  constructor(private readonly adminDashboardService: AdminDashboardService) {}

  /** Live counts per section, the attention queue, and booking finance. */
  @Get('getSummary')
  getSummary() {
    return this.adminDashboardService.summary();
  }
}
