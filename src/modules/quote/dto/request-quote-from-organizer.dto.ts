import { IsMongoId } from 'class-validator';
import { RequestQuotesDto } from './request-quotes.dto';

/** "Get quote" on an organizer card — same draft, plus the target organizer. */
export class RequestQuoteFromOrganizerDto extends RequestQuotesDto {
  @IsMongoId()
  organizerId: string;
}
