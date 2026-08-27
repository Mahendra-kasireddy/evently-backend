import { Controller, Get } from '@nestjs/common';
import { ContentService, CUSTOMER_HOME_KEY } from './content.service';
import { Public } from '../../common/decorators/public.decorator';
import { PublicCache } from '../../common/decorators/cache-control.decorator';

@Controller('content')
export class ContentController {
  constructor(private readonly contentService: ContentService) {}

  /** All editable copy for the customer home screen (nav, hero, sections, tools). */
  @Public()
  @PublicCache(120, 600)
  @Get('getCustomerHomeContent')
  getCustomerHomeContent() {
    return this.contentService.getData(CUSTOMER_HOME_KEY);
  }

  /**
   * Landing-page statistics, counted from real bookings and organizers.
   *
   * Public and cached like the rest of this controller: it is marketing copy
   * that happens to be computed, and it changes at the pace bookings complete.
   */
  @Public()
  @PublicCache(300, 900)
  @Get('getPlatformStatistics')
  getPlatformStatistics() {
    return this.contentService.getPlatformStatistics();
  }
}
