import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { QuoteService } from './quote.service';
import { RequestQuotesDto } from './dto/request-quotes.dto';
import { RequestQuoteFromOrganizerDto } from './dto/request-quote-from-organizer.dto';
import { RespondQuotationDto } from './dto/respond-quotation.dto';
import { UpdateQuotationDto } from './dto/update-quotation.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Role } from '../../common/enums/role.enum';

@Controller('quote')
export class QuoteController {
  constructor(private readonly quoteService: QuoteService) {}

  // ----- Customer: requesting quotes -----

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

  // ----- Customer: viewing / acting -----

  /** All of the customer's quote requests (list + history). */
  @Get('getMyQuotes')
  getMyQuotes(@CurrentUser('userId') userId: string) {
    return this.quoteService.listForUser(userId);
  }

  /** One request with its quotations + status timeline. */
  @Get('getQuoteRequest/:id')
  getQuoteRequest(@CurrentUser('userId') userId: string, @Param('id') id: string) {
    return this.quoteService.getRequest(userId, id);
  }

  /** A single quotation (quote-detail screen). */
  @Get('getQuotation/:id')
  getQuotation(@CurrentUser('userId') userId: string, @Param('id') id: string) {
    return this.quoteService.getQuotation(userId, id);
  }

  /** Accept a quotation. */
  @Post('acceptQuotation/:id')
  acceptQuotation(@CurrentUser('userId') userId: string, @Param('id') id: string) {
    return this.quoteService.acceptQuotation(userId, id);
  }

  /** Reject a quotation. */
  @Post('rejectQuotation/:id')
  rejectQuotation(@CurrentUser('userId') userId: string, @Param('id') id: string) {
    return this.quoteService.rejectQuotation(userId, id);
  }

  /** Cancel the whole quote request. */
  @Patch('cancelRequest/:id')
  cancelRequest(@CurrentUser('userId') userId: string, @Param('id') id: string) {
    return this.quoteService.cancelRequest(userId, id);
  }

  // ----- Organizer: responding -----

  /** Requests visible to the organizer (targeted or open). */
  @UseGuards(RolesGuard)
  @Roles(Role.ORGANIZER, Role.ADMIN)
  @Get('incoming')
  incoming(@CurrentUser('userId') userId: string) {
    return this.quoteService.listIncoming(userId);
  }

  /** Submit a quotation for a request. */
  @UseGuards(RolesGuard)
  @Roles(Role.ORGANIZER, Role.ADMIN)
  @Post('respond/:requestId')
  respond(
    @CurrentUser('userId') userId: string,
    @Param('requestId') requestId: string,
    @Body() dto: RespondQuotationDto,
  ) {
    return this.quoteService.respond(userId, requestId, dto);
  }

  /** Revise an existing quotation. */
  @UseGuards(RolesGuard)
  @Roles(Role.ORGANIZER, Role.ADMIN)
  @Patch('updateQuotation/:id')
  updateQuotation(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateQuotationDto,
  ) {
    return this.quoteService.updateQuotation(userId, id, dto);
  }

  /** Withdraw a quotation. */
  @UseGuards(RolesGuard)
  @Roles(Role.ORGANIZER, Role.ADMIN)
  @Patch('withdrawQuotation/:id')
  withdrawQuotation(@CurrentUser('userId') userId: string, @Param('id') id: string) {
    return this.quoteService.withdrawQuotation(userId, id);
  }
}
