import { PartialType } from '@nestjs/mapped-types';
import { CreatePlanEventDto } from './create-plan-event.dto';

export class UpdatePlanEventDto extends PartialType(CreatePlanEventDto) {}
