import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { AdminEventService } from './admin-event.service';
import { ListQuoteRequestsDto } from './dto/list-quote-requests.dto';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';

/**
 * Admin-only view of the event pipeline. Read-only on purpose: an admin
 * cancelling somebody's quote request or answering on an organizer's behalf
 * would be acting as a party to a negotiation they are not in.
 */
@Controller('admin/event')
@UseGuards(RolesGuard)
@Roles(Role.ADMIN)
export class AdminEventController {
  constructor(private readonly adminEventService: AdminEventService) {}

  @Get('getEvents')
  getEvents(@Query() query: ListQuoteRequestsDto) {
    return this.adminEventService.list(query);
  }

  @Get('getStatusCounts')
  getStatusCounts() {
    return this.adminEventService.counts();
  }

  @Get('getEventById/:id')
  getEventById(@Param('id') id: string) {
    return this.adminEventService.detail(id);
  }
}
