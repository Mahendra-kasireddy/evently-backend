import { ArrayMaxSize, ArrayMinSize, IsArray, IsMongoId, IsOptional } from 'class-validator';
import { RequestQuotesDto } from './request-quotes.dto';

/**
 * "Get quote" on an organizer card, or the Plan wizard's shortlist — the same
 * draft, plus the organizers the customer chose themselves.
 *
 * Both shapes are accepted. `organizerIds` is what the app sends now; the
 * singular `organizerId` is the shape every build before shortlisting sent,
 * and those builds stay in customers' hands for weeks after a release. The
 * service normalises the two into one list, so nothing downstream has to know
 * which one arrived.
 */
export class RequestQuoteFromOrganizerDto extends RequestQuotesDto {
  @IsOptional()
  @IsMongoId()
  organizerId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  /*
   * Bounded because every entry is a person who is notified and expected to
   * price the job. The same ceiling as an automatic broadcast: one customer
   * choosing forty organizers by hand is how a marketplace teaches its supply
   * side to ignore requests.
   */
  @ArrayMaxSize(6)
  @IsMongoId({ each: true })
  organizerIds?: string[];
}
