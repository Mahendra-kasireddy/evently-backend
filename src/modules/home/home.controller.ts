import { Controller, Get } from '@nestjs/common';
import { HomeService } from './home.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('home')
export class HomeController {
  constructor(private readonly homeService: HomeService) {}

  /** Everything the customer home screen needs, in one authenticated call. */
  @Get('getHomeFeed')
  getHomeFeed(@CurrentUser('userId') userId: string) {
    return this.homeService.getHomeFeed(userId);
  }
}
