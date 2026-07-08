import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';

import { PlanService } from './plan.service';
import { PlanConfigService } from './plan-config.service';
import { PlanSubmissionService } from './plan-submission.service';
import { UpsertPlanDto } from './dto/upsert-plan.dto';
import { RecommendationQueryDto } from './dto/recommendation-query.dto';
import { Public } from '../../common/decorators/public.decorator';
import { PublicCache } from '../../common/decorators/cache-control.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('plan')
export class PlanController {
  constructor(
    private readonly planService: PlanService,
    private readonly configService: PlanConfigService,
    private readonly submissionService: PlanSubmissionService,
  ) {}

  // ----- Config (public, cacheable reference data) -----

  /** Aggregated config for the whole Plan Event wizard screen (one request). */
  @Public()
  @PublicCache(120, 600)
  @Get('getPlanScreen')
  getPlanScreen() {
    return this.configService.getPlanScreen();
  }

  @Public()
  @PublicCache(120, 600)
  @Get('occasions')
  getOccasions() {
    return this.configService.getOccasions();
  }

  @Public()
  @PublicCache(120, 600)
  @Get('cities')
  getCities() {
    return this.configService.getCities();
  }

  @Public()
  @PublicCache(120, 600)
  @Get('guest-ranges')
  getGuestRanges() {
    return this.configService.getGuestRanges();
  }

  @Public()
  @PublicCache(120, 600)
  @Get('budget-ranges')
  getBudgetRanges() {
    return this.configService.getBudgetRanges();
  }

  @Public()
  @PublicCache(120, 600)
  @Get('service-categories')
  getServiceCategories() {
    return this.configService.getServiceCategories();
  }

  // ----- Recommendations -----

  /** Real organizers scored against the plan context (?categories=a,b&city=&occasion=&guests=). */
  @Public()
  @PublicCache(60, 300)
  @Get('getOrganizers')
  getOrganizers(@Query() query: RecommendationQueryDto) {
    return this.planService.recommend(this.toContext(query));
  }

  /** Alias of getOrganizers — the recommendation engine, explicit name. */
  @Public()
  @PublicCache(60, 300)
  @Get('recommendations')
  getRecommendations(@Query() query: RecommendationQueryDto) {
    return this.planService.recommend(this.toContext(query));
  }

  private toContext(query: RecommendationQueryDto) {
    const categories = query.categories
      ? query.categories
          .split(',')
          .map((c) => c.trim())
          .filter(Boolean)
      : [];
    return {
      categories,
      occasion: query.occasion,
      guests: query.guests,
      city: query.city,
      budget: query.budget,
    };
  }

  // ----- Persistence (authenticated customer) -----

  /** Upsert the customer's live draft (silent autosave). */
  @Put('saveDraft')
  saveDraft(@CurrentUser('userId') userId: string, @Body() dto: UpsertPlanDto) {
    return this.submissionService.saveDraft(userId, dto);
  }

  /** Resume the customer's live draft (null if none). */
  @Get('getMyDraft')
  getMyDraft(@CurrentUser('userId') userId: string) {
    return this.submissionService.getMyDraft(userId);
  }

  /** Submit a plan — persists it and returns the created record + plan code. */
  @Post('createPlan')
  createPlan(@CurrentUser('userId') userId: string, @Body() dto: UpsertPlanDto) {
    return this.submissionService.submit(userId, dto);
  }

  /** All plans owned by the customer. */
  @Get('getMyPlans')
  getMyPlans(@CurrentUser('userId') userId: string) {
    return this.submissionService.findMine(userId);
  }

  @Get('getPlan/:id')
  getPlan(@CurrentUser('userId') userId: string, @Param('id') id: string) {
    return this.submissionService.findOne(userId, id);
  }

  @Patch('updatePlan/:id')
  updatePlan(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
    @Body() dto: UpsertPlanDto,
  ) {
    return this.submissionService.update(userId, id, dto);
  }

  @Delete('deletePlan/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deletePlan(@CurrentUser('userId') userId: string, @Param('id') id: string) {
    return this.submissionService.remove(userId, id);
  }
}
