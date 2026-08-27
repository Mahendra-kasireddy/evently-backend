import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ContactService } from './contact.service';
import { ListContactRequestsDto } from './dto/list-contact-requests.dto';
import { RespondContactRequestDto } from './dto/respond-contact-request.dto';
import { UpdateContactStatusDto } from './dto/update-contact-status.dto';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

/**
 * Admin-only support queue.
 *
 * The class-level @Roles(Role.ADMIN) + RolesGuard is the authorization, exactly
 * as on AdminOrganizerController: it runs on every route here, so a customer or
 * a guest hitting these URLs directly gets 403 whatever any client renders. The
 * console's own role gate is convenience on top of this, never a substitute.
 */
@Controller('admin/contact-us')
@UseGuards(RolesGuard)
@Roles(Role.ADMIN)
export class AdminContactController {
  constructor(private readonly contactService: ContactService) {}

  /** Paginated, searchable, status-filtered queue. */
  @Get('getContactRequests')
  getContactRequests(@Query() query: ListContactRequestsDto) {
    return this.contactService.list(query);
  }

  /** Real per-status counts for the filter chips. */
  @Get('getStatusCounts')
  getStatusCounts() {
    return this.contactService.counts();
  }

  @Get('getContactRequestById/:id')
  getContactRequestById(@Param('id') id: string) {
    return this.contactService.detail(id);
  }

  @Patch('updateStatus/:id')
  updateStatus(@Param('id') id: string, @Body() dto: UpdateContactStatusDto) {
    return this.contactService.updateStatus(id, dto.status);
  }

  /** Save the reply, stamp who sent it and when, and move it to RESPONDED. */
  @Post('respond/:id')
  respond(
    @Param('id') id: string,
    @Body() dto: RespondContactRequestDto,
    @CurrentUser('userId') adminUserId: string,
  ) {
    return this.contactService.respond(id, dto, adminUserId);
  }
}
