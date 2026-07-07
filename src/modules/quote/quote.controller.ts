import { Body, Controller, Get, Post } from '@nestjs/common';
import { QuoteService } from './quote.service';
import { RequestQuotesDto } from './dto/request-quotes.dto';
import { RequestQuoteFromOrganizerDto } from './dto/request-quote-from-organizer.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('quote')
export class QuoteController {
  constructor(private readonly quoteService: QuoteService) {}

  /** Hero "Get quotes" — open request from the draft. */
  @Post('requestQuotes')
  requestQuotes(@CurrentUser('userId') userId: string, @Body() dto: RequestQuotesDto) {
    return this.quoteService.createFromDraft(userId, dto);
  }

  /** Organizer card "Get quote" — request targeted at one organizer. */
  @Post('requestQuoteFromOrganizer')
  requestQuoteFromOrganizer(
    @CurrentUser('userId') userId: string,
    @Body() dto: RequestQuoteFromOrganizerDto,
  ) {
    return this.quoteService.createForOrganizer(userId, dto);
  }

  /** The user's quote requests (for the /quotes screen). */
  @Get('getMyQuotes')
  getMyQuotes(@CurrentUser('userId') userId: string) {
    return this.quoteService.listForUser(userId);
  }
}
