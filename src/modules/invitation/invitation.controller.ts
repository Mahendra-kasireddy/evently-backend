import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { InvitationService } from './invitation.service';
import { UpdateInvitationDto } from './dto/update-invitation.dto';
import { RequestChangeDto } from './dto/request-change.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Role } from '../../common/enums/role.enum';

/** Organizer-side invitation builder (P-15). */
@Controller('invitation')
export class InvitationController {
  constructor(private readonly invitationService: InvitationService) {}

  @UseGuards(RolesGuard)
  @Roles(Role.ORGANIZER, Role.ADMIN)
  @Get('organizer/:bookingId')
  getForOrganizer(@CurrentUser('userId') userId: string, @Param('bookingId') bookingId: string) {
    return this.invitationService.getForOrganizer(userId, bookingId);
  }

  @UseGuards(RolesGuard)
  @Roles(Role.ORGANIZER, Role.ADMIN)
  @Patch('organizer/:bookingId')
  update(
    @CurrentUser('userId') userId: string,
    @Param('bookingId') bookingId: string,
    @Body() dto: UpdateInvitationDto,
  ) {
    return this.invitationService.updateForOrganizer(userId, bookingId, dto);
  }

  @UseGuards(RolesGuard)
  @Roles(Role.ORGANIZER, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @Post('organizer/:bookingId/send')
  send(@CurrentUser('userId') userId: string, @Param('bookingId') bookingId: string) {
    return this.invitationService.sendToCustomer(userId, bookingId);
  }

  // ----- Customer: review + sign-off -----

  @UseGuards(RolesGuard)
  @Roles(Role.CUSTOMER, Role.ADMIN)
  /** Status of every invitation shared with this customer (My Events). */
  @Get('mine')
  listMine(@CurrentUser('userId') userId: string) {
    return this.invitationService.listForCustomer(userId);
  }

  @UseGuards(RolesGuard)
  @Roles(Role.CUSTOMER, Role.ADMIN)
  @Get('mine/:bookingId')
  getForCustomer(@CurrentUser('userId') userId: string, @Param('bookingId') bookingId: string) {
    return this.invitationService.getForCustomer(userId, bookingId);
  }

  @UseGuards(RolesGuard)
  @Roles(Role.CUSTOMER, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @Post('mine/:bookingId/approve')
  approve(@CurrentUser('userId') userId: string, @Param('bookingId') bookingId: string) {
    return this.invitationService.approve(userId, bookingId);
  }

  /*
   * No per-section approve or edit. The invitation is reviewed and approved
   * as one piece: the customer approves the whole version they were sent, or
   * asks for changes to it, below.
   */

  /** Ask the organizer for changes to the invitation. */
  @UseGuards(RolesGuard)
  @Roles(Role.CUSTOMER, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @Post('mine/:bookingId/request-change')
  requestChange(
    @CurrentUser('userId') userId: string,
    @Param('bookingId') bookingId: string,
    @Body() dto: RequestChangeDto,
  ) {
    return this.invitationService.requestChange(userId, bookingId, dto);
  }

  /** Organizer marking one of those asks as dealt with. */
  @UseGuards(RolesGuard)
  @Roles(Role.ORGANIZER, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @Post('organizer/:bookingId/change-requests/:requestId/resolve')
  resolveChangeRequest(
    @CurrentUser('userId') userId: string,
    @Param('bookingId') bookingId: string,
    @Param('requestId') requestId: string,
  ) {
    return this.invitationService.resolveChangeRequest(userId, bookingId, requestId);
  }
}
