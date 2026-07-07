import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PlanEventService } from './plan-event.service';
import { PlanEventController } from './plan-event.controller';
import { Event, EventSchema } from './schemas/event.schema';

@Module({
  imports: [MongooseModule.forFeature([{ name: Event.name, schema: EventSchema }])],
  controllers: [PlanEventController],
  providers: [PlanEventService],
  exports: [PlanEventService],
})
export class PlanEventModule {}
