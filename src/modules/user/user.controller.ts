import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { UserService } from './user.service';
import { UpdateProfileDto, UpdateUserDto } from './dto/update-user.dto';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Role } from '../../common/enums/role.enum';

@Controller('user')
@UseGuards(RolesGuard)
export class UserController {
  constructor(private readonly userService: UserService) {}

  /** Current authenticated user's profile. */
  @Get('getUserDetails')
  getUserDetails(@CurrentUser() user: AuthUser) {
    return this.userService.findById(user.userId);
  }

  /** Compact profile for the home header/greeting (name, initials, location). */
  @Get('getProfileSummary')
  getProfileSummary(@CurrentUser() user: AuthUser) {
    return this.userService.getProfileSummary(user.userId);
  }

  /**
   * Self-service profile update.
   *
   * Takes `UpdateProfileDto`, which does not declare `roles` or `status` — the
   * global `whitelist: true` pipe therefore strips them from the body before
   * this method runs. That omission is the control; nothing downstream filters
   * the DTO, so a field declared here is a field the caller can write.
   */
  @Patch('updateProfile')
  updateProfile(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto) {
    return this.userService.update(user.userId, dto);
  }

  @Get('getUserById/:id')
  @Roles(Role.ADMIN)
  getUserById(@Param('id') id: string) {
    return this.userService.findById(id);
  }

  @Patch('updateUser/:id')
  @Roles(Role.ADMIN)
  updateUser(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.userService.update(id, dto);
  }
}
