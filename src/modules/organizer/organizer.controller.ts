import { Controller, Get, Param, Query } from '@nestjs/common';
import { OrganizerService } from './organizer.service';
import { Public } from '../../common/decorators/public.decorator';
import { PublicCache } from '../../common/decorators/cache-control.decorator';

@Controller('organizer')
export class OrganizerController {
  constructor(private readonly organizerService: OrganizerService) {}

  /** Home "Top organizers near you" cards. */
  @Public()
  @PublicCache(60, 300)
  @Get('getTopOrganizers')
  getTopOrganizers(@Query('limit') limit?: string) {
    const n = limit ? Math.min(parseInt(limit, 10) || 6, 50) : 6;
    return this.organizerService.findTop(n);
  }

  /** Organizer profile detail ("View Profile"). */
  @Public()
  @PublicCache(60, 300)
  @Get('getOrganizerById/:id')
  getOrganizerById(@Param('id') id: string) {
    return this.organizerService.findById(id);
  }
}
