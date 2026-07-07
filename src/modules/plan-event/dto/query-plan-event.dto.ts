import { IsEnum, IsOptional, IsString } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { EventStatus } from '../schemas/event.schema';

export class QueryPlanEventDto extends PaginationDto {
  @IsOptional()
  @IsEnum(EventStatus)
  status?: EventStatus;

  @IsOptional()
  @IsString()
  category?: string;

  /** Free-text search on title. */
  @IsOptional()
  @IsString()
  q?: string;
}
