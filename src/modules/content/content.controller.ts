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
}
