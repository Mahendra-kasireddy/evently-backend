import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { InvitationGuestService } from './invitation-guest.service';
import { AddGuestDto } from '../dto/add-guest.dto';
import { ShareInvitationDto } from '../dto/share-invitation.dto';
import { guestAppUrl } from './share-links';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Role } from '../../../common/enums/role.enum';

/** Escapes text going into an HTML attribute or body. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Guest sharing for the published invitation.
 *
 * Split from `InvitationController` because this is the only part of the
 * feature with an unauthenticated surface, and keeping that in one small file
 * makes the boundary obvious to anyone reading it later.
 */
@Controller('invitation')
export class InvitationGuestController {
  constructor(
    private readonly guests: InvitationGuestService,
    private readonly config: ConfigService,
  ) {}

  // ----- customer -------------------------------------------------------

  @UseGuards(RolesGuard)
  @Roles(Role.CUSTOMER, Role.ADMIN)
  @Get('mine/:bookingId/guests')
  list(@CurrentUser('userId') userId: string, @Param('bookingId') bookingId: string) {
    return this.guests.listGuests(userId, bookingId);
  }

  @UseGuards(RolesGuard)
  @Roles(Role.CUSTOMER, Role.ADMIN)
  @Post('mine/:bookingId/guests')
  add(
    @CurrentUser('userId') userId: string,
    @Param('bookingId') bookingId: string,
    @Body() dto: AddGuestDto,
  ) {
    return this.guests.addGuest(userId, bookingId, dto);
  }

  /** Share one section, or the whole invitation, with one or more guests. */
  @UseGuards(RolesGuard)
  @Roles(Role.CUSTOMER, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @Post('mine/:bookingId/share')
  share(
    @CurrentUser('userId') userId: string,
    @Param('bookingId') bookingId: string,
    @Body() dto: ShareInvitationDto,
  ) {
    return this.guests.share(userId, bookingId, dto);
  }

  // ----- guest ----------------------------------------------------------

  /**
   * The published invitation, for a guest holding a share link.
   *
   * Public by necessity: the spec forbids guest login, so the token in the URL
   * is the credential. It resolves only approved invitations and returns a
   * guest-shaped payload — see `guestView`.
   */
  @Public()
  @Get('shared/:token')
  viewShared(@Param('token') token: string) {
    return this.guests.viewByToken(token);
  }

  /**
   * The link a guest is actually sent.
   *
   * Returns HTML rather than JSON because this exists for WhatsApp's crawler,
   * which does not run JavaScript: the SPA's `index.html` is one static shell
   * with no per-invitation tags, so a link straight to the app can never
   * produce a preview card. A real browser is redirected on to the app
   * immediately; the crawler stays for the meta tags.
   */
  @Public()
  @Get('shared/:token/preview')
  async preview(
    @Param('token') token: string,
    @Query('section') section: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const webBase = this.config.get<string>('publicUrls.web') ?? '';
    const data = await this.guests.previewByToken(token);

    if (!data) {
      // No detail about why: an invalid token and a withdrawn invitation must
      // look identical from outside.
      res
        .status(HttpStatus.NOT_FOUND)
        .type('html')
        .send(
          `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
            `<meta name="robots" content="noindex"><title>Invitation not available</title></head>` +
            `<body><p>This invitation link is no longer available.</p></body></html>`,
        );
      return;
    }

    const target = guestAppUrl(webBase, token, (section ?? '').trim());
    const title = data.hosts
      ? `${data.hosts} invite you — ${data.eventName}`
      : `You’re invited — ${data.eventName}`;
    const description = `${data.guestName}, you’re invited to ${data.eventName}. Tap to open your invitation.`;
    const image = `${webBase.replace(/\/+$/, '')}/og-invitation.png`;

    // noindex: a guest link is private to whoever holds it, and a search
    // engine following one would publish the invitation to everybody.
    res
      .status(HttpStatus.OK)
      .type('html')
      .set('Cache-Control', 'no-store')
      .send(
        `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(title)}</title>
<meta property="og:type" content="website">
<meta property="og:site_name" content="Evently">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:image" content="${escapeHtml(image)}">
<meta property="og:url" content="${escapeHtml(target)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
<meta name="twitter:image" content="${escapeHtml(image)}">
<link rel="canonical" href="${escapeHtml(target)}">
</head>
<body>
<p><a id="go" href="${escapeHtml(target)}">Open your invitation</a></p>
<script>location.replace(${JSON.stringify(target)});</script>
</body>
</html>`,
      );
  }
}
