import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { SubvendorService } from './subvendor.service';
import {
  OnboardSubvendorDto,
  InviteSubvendorDto,
  RateSubvendorDto,
} from './dto/onboard-subvendor.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Role } from '../../common/enums/role.enum';

@Controller('subvendor')
export class SubvendorController {
  constructor(private readonly subvendorService: SubvendorService) {}

  // ----- Sub-vendor: onboarding + own profile -----

  @Post('onboard')
  onboard(@CurrentUser('userId') userId: string, @Body() dto: OnboardSubvendorDto) {
    return this.subvendorService.onboard(userId, dto);
  }

  @UseGuards(RolesGuard)
  @Roles(Role.VENDOR, Role.ADMIN)
  @Get('profile')
  getProfile(@CurrentUser('userId') userId: string) {
    return this.subvendorService.getProfile(userId);
  }

  @UseGuards(RolesGuard)
  @Roles(Role.VENDOR, Role.ADMIN)
  @Get('my-organizers')
  myOrganizers(@CurrentUser('userId') userId: string) {
    return this.subvendorService.myOrganizers(userId);
  }
}

@Controller('organizer/subvendors')
export class OrganizerSubvendorController {
  constructor(private readonly subvendorService: SubvendorService) {}

  @UseGuards(RolesGuard)
  @Roles(Role.ORGANIZER, Role.ADMIN)
  @Get()
  list(@CurrentUser('userId') userId: string) {
    return this.subvendorService.listForOrganizer(userId);
  }

  @UseGuards(RolesGuard)
  @Roles(Role.ORGANIZER, Role.ADMIN)
  @Post('invite')
  invite(@CurrentUser('userId') userId: string, @Body() dto: InviteSubvendorDto) {
    return this.subvendorService.invite(userId, dto.phone);
  }

  @UseGuards(RolesGuard)
  @Roles(Role.ORGANIZER, Role.ADMIN)
  @Delete(':linkId')
  remove(@CurrentUser('userId') userId: string, @Param('linkId') linkId: string) {
    return this.subvendorService.remove(userId, linkId);
  }

  @UseGuards(RolesGuard)
  @Roles(Role.ORGANIZER, Role.ADMIN)
  @Post(':linkId/rate')
  rate(
    @CurrentUser('userId') userId: string,
    @Param('linkId') linkId: string,
    @Body() dto: RateSubvendorDto,
  ) {
    return this.subvendorService.rate(userId, linkId, dto.rating);
  }
}
