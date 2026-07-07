import { Controller, Get, Query } from '@nestjs/common';
import { PlanService } from './plan.service';
import { Public } from '../../common/decorators/public.decorator';
import { PublicCache } from '../../common/decorators/cache-control.decorator';

@Controller('plan')
export class PlanController {
  constructor(private readonly planService: PlanService) {}

  /** All copy/config for the Plan Event wizard screen. */
  @Public()
  @PublicCache(120, 600)
  @Get('getPlanScreen')
  getPlanScreen() {
    return this.planService.getPlanScreen();
  }

  /** Real organizers matched against the selected categories (?categories=a,b,c). */
  @Public()
  @PublicCache(60, 300)
  @Get('getOrganizers')
  getOrganizers(@Query('categories') categories?: string) {
    const ids = categories
      ? categories
          .split(',')
          .map((c) => c.trim())
          .filter(Boolean)
      : [];
    return this.planService.getOrganizers(ids);
  }
}
