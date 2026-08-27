import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { QuoteRequestStatus } from '../schemas/quote-request.schema';

/** Admin event-pipeline query: ?status=&search=&page=&limit= */
export class ListQuoteRequestsDto extends PaginationDto {
  @IsOptional()
  @IsEnum(QuoteRequestStatus, { message: 'Unknown request status' })
  status?: QuoteRequestStatus;

  /** Matches occasion, venue or the customer's name. */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  search?: string;
}
