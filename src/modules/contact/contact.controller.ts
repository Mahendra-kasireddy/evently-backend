import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ContactService, SUBJECT_LABEL } from './contact.service';
import { CreateContactRequestDto } from './dto/create-contact-request.dto';
import { ContactSubject } from './schemas/contact-request.schema';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';

/**
 * Customer-facing Contact Us.
 *
 * `POST /contact-us` is deliberately reachable without an account: making
 * someone register before they can report a problem is how support requests
 * turn into abandoned sessions. @Public() steps the global JwtAuthGuard aside
 * and OptionalJwtAuthGuard attaches the user only when a valid token came
 * along, so one endpoint serves both cases and the owning account is always
 * the token's, never the body's.
 *
 * The global ThrottlerGuard (100 req/min per IP) already covers this route, so
 * the open endpoint is not an open floodgate.
 */
@Controller('contact-us')
export class ContactController {
  constructor(private readonly contactService: ContactService) {}

  /** The subject options the form offers. Served so the two can never drift. */
  @Public()
  @Get('subjects')
  subjects(): Array<{ value: ContactSubject; label: string }> {
    return Object.values(ContactSubject).map((value) => ({
      value,
      label: SUBJECT_LABEL[value],
    }));
  }

  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @Post()
  create(@Body() dto: CreateContactRequestDto, @CurrentUser() user?: AuthUser) {
    return this.contactService.create(dto, user?.userId);
  }

  /** Name/email/phone on file, so a signed-in customer does not retype them. */
  @Get('prefill')
  prefill(@CurrentUser('userId') userId: string) {
    return this.contactService.prefillFor(userId);
  }
}
