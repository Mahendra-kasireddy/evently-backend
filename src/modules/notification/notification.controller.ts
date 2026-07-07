import { Controller, Get, Param, Patch } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('notification')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  /** The signed-in user's notification list. */
  @Get('getMyNotifications')
  getMyNotifications(@CurrentUser('userId') userId: string) {
    return this.notificationService.listForUser(userId);
  }

  /** Unread count for the header bell. */
  @Get('getUnreadCount')
  async getUnreadCount(@CurrentUser('userId') userId: string) {
    return { count: await this.notificationService.unreadCount(userId) };
  }

  @Patch('markRead/:id')
  markRead(@CurrentUser('userId') userId: string, @Param('id') id: string) {
    return this.notificationService.markRead(userId, id);
  }

  @Patch('markAllRead')
  markAllRead(@CurrentUser('userId') userId: string) {
    return this.notificationService.markAllRead(userId);
  }
}
