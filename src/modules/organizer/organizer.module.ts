import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { OrganizerService } from './organizer.service';
import {
  OrganizerConfigService,
  CITY_REF_MODEL,
  OCCASION_REF_MODEL,
  SERVICE_CATEGORY_REF_MODEL,
} from './organizer-config.service';
import { OrganizerOnboardingService } from './organizer-onboarding.service';
import { AcademyService } from './academy.service';
import { OrganizerController } from './organizer.controller';
import { OrganizerProfile, OrganizerProfileSchema } from './schemas/organizer-profile.schema';
import { AcademyProgress, AcademyProgressSchema } from './schemas/academy-progress.schema';
import { BusinessType, BusinessTypeSchema } from './schemas/business-type.schema';
import { OrganizerCategory, OrganizerCategorySchema } from './schemas/organizer-category.schema';
import {
  ExperienceRange,
  ExperienceRangeSchema,
  TeamSize,
  TeamSizeSchema,
  Language,
  LanguageSchema,
  TravelOption,
  TravelOptionSchema,
  PaymentMethod,
  PaymentMethodSchema,
  WorkingDay,
  WorkingDaySchema,
  DocumentType,
  DocumentTypeSchema,
} from './schemas/services-config.schema';
import { PlanCitySchema } from '../plan/schemas/plan-city.schema';
import { PlanOccasionSchema } from '../plan/schemas/plan-occasion.schema';
import { PlanServiceCategorySchema } from '../plan/schemas/plan-service-category.schema';
import { AuthModule } from '../auth/auth.module';
import { UserModule } from '../user/user.module';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: OrganizerProfile.name, schema: OrganizerProfileSchema },
      { name: AcademyProgress.name, schema: AcademyProgressSchema },
      { name: BusinessType.name, schema: BusinessTypeSchema },
      { name: OrganizerCategory.name, schema: OrganizerCategorySchema },
      // Step 4 (Services) config collections.
      { name: ExperienceRange.name, schema: ExperienceRangeSchema },
      { name: TeamSize.name, schema: TeamSizeSchema },
      { name: Language.name, schema: LanguageSchema },
      { name: TravelOption.name, schema: TravelOptionSchema },
      { name: PaymentMethod.name, schema: PaymentMethodSchema },
      { name: WorkingDay.name, schema: WorkingDaySchema },
      { name: DocumentType.name, schema: DocumentTypeSchema },
      // Reuse existing plan_* collections under distinct model tokens — read-only
      // here, no duplicated data.
      { name: CITY_REF_MODEL, schema: PlanCitySchema },
      { name: OCCASION_REF_MODEL, schema: PlanOccasionSchema },
      { name: SERVICE_CATEGORY_REF_MODEL, schema: PlanServiceCategorySchema },
    ]),
    // Reuse existing auth (token re-issue), user (roles), notification flows.
    AuthModule,
    UserModule,
    NotificationModule,
  ],
  controllers: [OrganizerController],
  providers: [OrganizerService, OrganizerConfigService, OrganizerOnboardingService, AcademyService],
  exports: [OrganizerService],
})
export class OrganizerModule {}
