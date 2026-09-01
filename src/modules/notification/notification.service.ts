import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Notification,
  NotificationDocument,
  NotificationType,
} from './schemas/notification.schema';
import { UserService } from '../user/user.service';

@Injectable()
export class NotificationService {
  constructor(
    @InjectModel(Notification.name)
    private readonly notificationModel: Model<NotificationDocument>,
    private readonly userService: UserService,
  ) {}

  /** A user's notifications, newest first. */
  listForUser(userId: string, limit = 20): Promise<NotificationDocument[]> {
    return this.notificationModel
      .find({ user: userId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .exec();
  }

  /** Count of unread notifications — drives the header bell indicator. */
  unreadCount(userId: string): Promise<number> {
    return this.notificationModel.countDocuments({ user: userId, read: false }).exec();
  }

  async markRead(userId: string, id: string): Promise<{ ok: true }> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Notification not found');
    const res = await this.notificationModel
      .updateOne({ _id: id, user: userId }, { read: true, readAt: new Date() })
      .exec();
    if (res.matchedCount === 0) throw new NotFoundException('Notification not found');
    return { ok: true };
  }

  async markAllRead(userId: string): Promise<{ updated: number }> {
    const res = await this.notificationModel
      .updateMany({ user: userId, read: false }, { read: true, readAt: new Date() })
      .exec();
    return { updated: res.modifiedCount };
  }

  /**
   * Which preference governs which kind of notice.
   *
   * BOOKING and PAYMENT are absent on purpose: they are the record of money
   * moving and of a commitment made, and a customer cannot opt out of being
   * told their event was declined or their payment failed. Everything a
   * customer *can* silence is listed here, and silencing it works.
   */
  private static readonly GOVERNED_BY: Partial<
    Record<NotificationType, 'quotes' | 'invitations' | 'marketing'>
  > = {
    [NotificationType.QUOTE]: 'quotes',
  };

  /**
   * Create a notification (used by other flows: booking confirmed, quote
   * received, etc.).
   *
   * Returns null when the recipient has turned this kind off — the preference
   * is checked here rather than at each call site, so a new flow cannot forget
   * to honour it.
   */
  async create(
    userId: string,
    title: string,
    body = '',
    type: NotificationType = NotificationType.SYSTEM,
    link?: string,
  ): Promise<NotificationDocument | null> {
    if (!(await this.wants(userId, type))) return null;
    return this.notificationModel.create({ user: userId, title, body, type, link });
  }

  /** False only when the recipient has explicitly silenced this kind. */
  private async wants(userId: string, type: NotificationType): Promise<boolean> {
    const key = NotificationService.GOVERNED_BY[type];
    if (!key) return true;
    try {
      const prefs = await this.userService.getNotificationPrefs(userId);
      return prefs[key];
    } catch {
      // An unreadable preference must not swallow the notification.
      return true;
    }
  }
}
