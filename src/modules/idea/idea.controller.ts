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
import { IdeaService } from './idea.service';
import { CreateIdeaDto } from './dto/create-idea.dto';
import { ReplyIdeaDto } from './dto/reply-idea.dto';
import { UpdateVisionDto } from './dto/update-vision.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Role } from '../../common/enums/role.enum';

/** Ideas & planning board for one booking (customer ⇄ organizer). */
@Controller('idea')
export class IdeaController {
  constructor(private readonly ideaService: IdeaService) {}

  // ----- Customer -----

  @UseGuards(RolesGuard)
  @Roles(Role.CUSTOMER, Role.ADMIN)
  @Get('mine/:bookingId')
  listMine(@CurrentUser('userId') userId: string, @Param('bookingId') bookingId: string) {
    return this.ideaService.listForCustomer(userId, bookingId);
  }

  @UseGuards(RolesGuard)
  @Roles(Role.CUSTOMER, Role.ADMIN)
  @Post('mine/:bookingId')
  createMine(
    @CurrentUser('userId') userId: string,
    @Param('bookingId') bookingId: string,
    @Body() dto: CreateIdeaDto,
  ) {
    return this.ideaService.createForCustomer(userId, bookingId, dto);
  }

  @UseGuards(RolesGuard)
  @Roles(Role.CUSTOMER, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @Post('mine/:ideaId/approve')
  approve(@CurrentUser('userId') userId: string, @Param('ideaId') ideaId: string) {
    return this.ideaService.approve(userId, ideaId);
  }

  // ----- Organizer -----

  @UseGuards(RolesGuard)
  @Roles(Role.ORGANIZER, Role.ADMIN)
  @Get('organizer/:bookingId')
  listForOrganizer(@CurrentUser('userId') userId: string, @Param('bookingId') bookingId: string) {
    return this.ideaService.listForOrganizer(userId, bookingId);
  }

  @UseGuards(RolesGuard)
  @Roles(Role.ORGANIZER, Role.ADMIN)
  @Post('organizer/:bookingId')
  createForOrganizer(
    @CurrentUser('userId') userId: string,
    @Param('bookingId') bookingId: string,
    @Body() dto: CreateIdeaDto,
  ) {
    return this.ideaService.createForOrganizer(userId, bookingId, dto);
  }

  @UseGuards(RolesGuard)
  @Roles(Role.ORGANIZER, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @Post('organizer/:ideaId/reply')
  reply(
    @CurrentUser('userId') userId: string,
    @Param('ideaId') ideaId: string,
    @Body() dto: ReplyIdeaDto,
  ) {
    return this.ideaService.reply(userId, ideaId, dto);
  }

  /**
   * The organizer's summary of the event, which the customer reads back on
   * their own board. Organizer-only by design: it is their understanding.
   */
  @UseGuards(RolesGuard)
  @Roles(Role.ORGANIZER, Role.ADMIN)
  @Patch('organizer/:bookingId/vision')
  updateVision(
    @CurrentUser('userId') userId: string,
    @Param('bookingId') bookingId: string,
    @Body() dto: UpdateVisionDto,
  ) {
    return this.ideaService.updateVision(userId, bookingId, dto);
  }
}
