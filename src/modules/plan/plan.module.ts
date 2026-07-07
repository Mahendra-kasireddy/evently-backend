import { Module } from '@nestjs/common';
import { PlanService } from './plan.service';
import { PlanController } from './plan.controller';
import { ContentModule } from '../content/content.module';
import { OrganizerModule } from '../organizer/organizer.module';

/** Plan Event screen module (BFF). Composes content + organizers for the wizard. */
@Module({
  imports: [ContentModule, OrganizerModule],
  controllers: [PlanController],
  providers: [PlanService],
})
export class PlanModule {}
