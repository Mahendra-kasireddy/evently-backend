import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Notification,
  NotificationDocument,
  NotificationType,
} from './schemas/notification.schema';

@Injectable()
export class NotificationService {
  constructor(
    @InjectModel(Notification.name)
    private readonly notificationModel: Model<NotificationDocument>,
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

  /** Create a notification (used by other flows: booking confirmed, quote received, etc.). */
  create(
    userId: string,
    title: string,
    body = '',
    type: NotificationType = NotificationType.SYSTEM,
    link?: string,
  ): Promise<NotificationDocument> {
    return this.notificationModel.create({ user: userId, title, body, type, link });
  }
}
