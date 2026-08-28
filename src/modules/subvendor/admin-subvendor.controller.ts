import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { AdminSubvendorService } from './admin-subvendor.service';
import { ListSubVendorsDto } from './dto/list-subvendors.dto';
import { UpdateSubVendorActiveDto } from './dto/update-subvendor-active.dto';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';

/** Admin-only sub-vendor roster. Authorization is the class-level guard. */
@Controller('admin/subvendor')
@UseGuards(RolesGuard)
@Roles(Role.ADMIN)
export class AdminSubvendorController {
  constructor(private readonly adminSubvendorService: AdminSubvendorService) {}

  @Get('getSubVendors')
  getSubVendors(@Query() query: ListSubVendorsDto) {
    return this.adminSubvendorService.list(query);
  }

  @Get('getStatusCounts')
  getStatusCounts() {
    return this.adminSubvendorService.counts();
  }

  @Get('getSubVendorById/:id')
  getSubVendorById(@Param('id') id: string) {
    return this.adminSubvendorService.detail(id);
  }

  /**
   * Mark a vendor's "Other" category suggestion as dealt with. It does not
   * create a category — that is an enum change in code.
   */
  @Patch('resolveCategoryRequest/:id')
  resolveCategoryRequest(@Param('id') id: string) {
    return this.adminSubvendorService.resolveCategoryRequest(id);
  }

  /** Take a vendor off the roster (or put them back). */
  @Patch('updateActive/:id')
  updateActive(@Param('id') id: string, @Body() dto: UpdateSubVendorActiveDto) {
    return this.adminSubvendorService.setActive(id, dto.active);
  }
}
