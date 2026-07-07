import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { PlanService } from './plan.service';
import { PlanConfigService } from './plan-config.service';
import { PlanSubmissionService } from './plan-submission.service';
import { PlanController } from './plan.controller';
import { ContentModule } from '../content/content.module';
import { OrganizerModule } from '../organizer/organizer.module';

import { PlanOccasion, PlanOccasionSchema } from './schemas/plan-occasion.schema';
import { PlanCity, PlanCitySchema } from './schemas/plan-city.schema';
import { PlanGuestRange, PlanGuestRangeSchema } from './schemas/plan-guest-range.schema';
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
    MongooseModule.forFeature([
      { name: PlanOccasion.name, schema: PlanOccasionSchema },
      { name: PlanCity.name, schema: PlanCitySchema },
      { name: PlanGuestRange.name, schema: PlanGuestRangeSchema },
      { name: PlanServiceCategory.name, schema: PlanServiceCategorySchema },
      { name: PlanSubmission.name, schema: PlanSubmissionSchema },
    ]),
  ],
  controllers: [PlanController],
  providers: [PlanService, PlanConfigService, PlanSubmissionService],
})
export class PlanModule {}
