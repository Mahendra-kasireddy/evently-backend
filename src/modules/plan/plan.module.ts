import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { PlanService } from './plan.service';
import { PlanConfigService } from './plan-config.service';
import { PlanSubmissionService } from './plan-submission.service';
import { PlanController } from './plan.controller';
import { ContentModule } from '../content/content.module';
import { OrganizerModule } from '../organizer/organizer.module';
import { NotificationModule } from '../notification/notification.module';

import { PlanOccasion, PlanOccasionSchema } from './schemas/plan-occasion.schema';
import { PlanCity, PlanCitySchema } from './schemas/plan-city.schema';
import { PlanGuestRange, PlanGuestRangeSchema } from './schemas/plan-guest-range.schema';
import { PlanBudgetRange, PlanBudgetRangeSchema } from './schemas/plan-budget-range.schema';
import {
  PlanServiceCategory,
  PlanServiceCategorySchema,
} from './schemas/plan-service-category.schema';
import { PlanSubmission, PlanSubmissionSchema } from './schemas/plan-submission.schema';

/**
 * Plan Event module (BFF + persistence). Serves the wizard config from
 * normalized collections + CMS content, recommends real organizers, and
 * persists customer plans (draft/submit/track).
 */
@Module({
  imports: [
    ContentModule,
    OrganizerModule,
    NotificationModule,
    MongooseModule.forFeature([
      { name: PlanOccasion.name, schema: PlanOccasionSchema },
      { name: PlanCity.name, schema: PlanCitySchema },
      { name: PlanGuestRange.name, schema: PlanGuestRangeSchema },
      { name: PlanBudgetRange.name, schema: PlanBudgetRangeSchema },
      { name: PlanServiceCategory.name, schema: PlanServiceCategorySchema },
      { name: PlanSubmission.name, schema: PlanSubmissionSchema },
    ]),
  ],
  controllers: [PlanController],
  providers: [PlanService, PlanConfigService, PlanSubmissionService],
  // Exported so the Home BFF can resolve the customer's latest active plan for
  // the "Current Event" card without duplicating plan persistence logic.
  exports: [PlanSubmissionService],
})
export class PlanModule {}
