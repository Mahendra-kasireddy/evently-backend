import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { UserService } from './user.service';
import { UpdateProfileDto, UpdateUserDto } from './dto/update-user.dto';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';
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

  /** The customer's own notification choices. */
  @Get('preferences')
  getPreferences(@CurrentUser('userId') userId: string) {
    return this.userService.getNotificationPrefs(userId);
  }

  /** Change them. Scoped to the signed-in account; ids are never accepted. */
  @Patch('preferences')
  updatePreferences(@CurrentUser('userId') userId: string, @Body() dto: UpdatePreferencesDto) {
    return this.userService.updateNotificationPrefs(userId, dto);
  }

  /**
   * Closes the signed-in account. Required by both app stores, and deliberately
   * only ever acts on the caller's own account — there is no id parameter to
   * point at somebody else's.
   */
  @Post('close-account')
  closeAccount(@CurrentUser('userId') userId: string) {
    return this.userService.closeOwnAccount(userId);
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
