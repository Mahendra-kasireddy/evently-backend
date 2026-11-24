import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AdminTeamService } from './admin-team.service';
import { InviteAdminDto } from './dto/invite-admin.dto';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

/**
 * The console's Team page: who the admins are, and inviting new ones.
 * Admin-only, like every /admin route — the guard, not the console, is what
 * keeps anyone else out.
 */
@Controller('admin/team')
@UseGuards(RolesGuard)
@Roles(Role.ADMIN)
export class AdminTeamController {
  constructor(private readonly team: AdminTeamService) {}

  @Get('getTeam')
  getTeam(@CurrentUser('userId') actorId: string) {
    return this.team.getTeam(actorId);
  }

  @Throttle({ default: { limit: 20, ttl: 600_000 } })
  @Post('invite')
  invite(@CurrentUser('userId') actorId: string, @Body() dto: InviteAdminDto) {
    return this.team.invite(actorId, dto);
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete('revokeInvite/:id')
  async revokeInvite(@CurrentUser('userId') actorId: string, @Param('id') id: string) {
    await this.team.revokeInvite(actorId, id);
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Patch('removeAdmin/:id')
  async removeAdmin(@CurrentUser('userId') actorId: string, @Param('id') id: string) {
    await this.team.removeAdmin(actorId, id);
  }
}
