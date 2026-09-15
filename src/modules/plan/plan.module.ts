import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { PlanService } from './plan.service';
import { PlanConfigService } from './plan-config.service';
import { PlanSubmissionService } from './plan-submission.service';
import { PlanController } from './plan.controller';
import { AdminPlanConfigController } from './admin-plan-config.controller';
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
import {
  OrganizerProfile,
  OrganizerProfileSchema,
} from '../organizer/schemas/organizer-profile.schema';

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
      // Read directly for the occasion tiles' "from" price; OrganizerModule is
      // already imported for the recommendation engine's richer needs.
      { name: OrganizerProfile.name, schema: OrganizerProfileSchema },
    ]),
  ],
  controllers: [PlanController, AdminPlanConfigController],
  providers: [PlanService, PlanConfigService, PlanSubmissionService],
  // Exported so the Home BFF can resolve the customer's latest active plan for
  // the "Current Event" card without duplicating plan persistence logic.
  /*
   * PlanConfigService is exported for the Home BFF, which builds the
   * "Plan something new" grid from the same occasion list the wizard uses.
   * Providing a service is not the same as exporting it — Nest resolves an
   * injection against the importing module's own context, so without this
   * line HomeModule fails to start.
   */
  /*
   * PlanService is exported for its recommendation engine: a quote broadcast
   * has to pick the same organizers the Plan wizard would have shown, and two
   * matchers would be two answers to one question.
   */
  exports: [PlanSubmissionService, PlanConfigService, PlanService],
})
export class PlanModule {}
