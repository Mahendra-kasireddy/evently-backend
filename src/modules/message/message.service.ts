import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Conversation, ConversationDocument } from './schemas/conversation.schema';
import { Message, MessageDocument, MessageSender } from './schemas/message.schema';
import {
  OrganizerProfile,
  OrganizerProfileDocument,
} from '../organizer/schemas/organizer-profile.schema';
import { User, UserDocument } from '../user/schemas/user.schema';
import { NotificationService } from '../notification/notification.service';
import { NotificationType } from '../notification/schemas/notification.schema';

/** A thread as one side's inbox lists it. */
export interface ConversationView {
  id: string;
  /** The other party, from the reader's point of view. */
  withName: string;
  withInitials: string;
  withAvatarColor: string;
  /** The organizer this thread is with — lets the client open their profile. */
  organizerId: string;
  lastMessageText: string;
  lastMessageAt: Date | null;
  unread: number;
  /**
   * How long this organizer usually takes to reply, in minutes, and how many
   * replies that was measured over. Zero samples means the app must not make
   * the claim at all — see `refreshReplyTime`.
   */
  replyMedianMinutes: number;
  replySamples: number;
}

export interface MessageView {
  id: string;
  sender: MessageSender;
  text: string;
  createdAt: Date | undefined;
}

/** Which side of a thread the reader is on. */
type Side = 'customer' | 'organizer';

const PAGE_SIZE = 50;

/*
 * How much history the reply-time median is taken over. Bounded because this
 * runs on the organizer's send path: a busy organizer must not pay a longer
 * aggregation for every message they answer.
 */
const REPLY_THREAD_LIMIT = 50;
const REPLY_MESSAGE_LIMIT = 500;

@Injectable()
export class MessageService {
  constructor(
    @InjectModel(Conversation.name)
    private readonly conversationModel: Model<ConversationDocument>,
    @InjectModel(Message.name) private readonly messageModel: Model<MessageDocument>,
    @InjectModel(OrganizerProfile.name)
    private readonly organizerModel: Model<OrganizerProfileDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly notificationService: NotificationService,
  ) {}

  /**
   * The thread between this customer and this organizer, creating it if there
   * is none.
   *
   * Idempotent by upsert rather than find-then-insert: two taps on "message
   * this organizer" land at once often enough, and the unique index would turn
   * the second into a 500 rather than the same thread.
   */
  async openWithOrganizer(userId: string, organizerId: string): Promise<ConversationView> {
    this.assertObjectId(organizerId, 'organizer');
    const organizer = await this.organizerModel.findById(organizerId).exec();
    if (!organizer || !organizer.active) throw new NotFoundException('Organizer not found');
    if (!organizer.user) {
      throw new NotFoundException('This organizer has no account to message yet');
    }

    const customer = new Types.ObjectId(userId);
    await this.conversationModel
      .findOneAndUpdate(
        { customer, organizer: organizer._id },
        { $setOnInsert: { customer, organizer: organizer._id, organizerUser: organizer.user } },
        { upsert: true, new: true },
      )
      .exec();

    const conversation = await this.conversationModel
      .findOne({ customer, organizer: organizer._id })
      .exec();
    if (!conversation) throw new NotFoundException('Conversation not found');

    return this.toView(
      conversation,
      'customer',
      organizer.name,
      organizer.initials,
      organizer.avatarColor,
      { medianMinutes: organizer.replyMedianMinutes, samples: organizer.replySamples },
    );
  }

  /** Every thread this customer has, most recently active first. */
  async listForCustomer(userId: string): Promise<ConversationView[]> {
    const rows = await this.conversationModel
      .find({ customer: new Types.ObjectId(userId) })
      .populate('organizer', 'name initials avatarColor replyMedianMinutes replySamples')
      .sort({ lastMessageAt: -1, createdAt: -1 })
      .exec();

    return rows.map((row) => {
      const organizer = row.organizer as unknown as {
        _id: Types.ObjectId;
        name?: string;
        initials?: string;
        avatarColor?: string;
        replyMedianMinutes?: number;
        replySamples?: number;
      };
      return this.toView(
        row,
        'customer',
        organizer?.name ?? 'Organizer',
        organizer?.initials ?? '?',
        organizer?.avatarColor ?? '#1a2e5a',
        { medianMinutes: organizer?.replyMedianMinutes, samples: organizer?.replySamples },
      );
    });
  }

  /** Every thread this organizer has, most recently active first. */
  async listForOrganizer(organizerUserId: string): Promise<ConversationView[]> {
    const rows = await this.conversationModel
      .find({ organizerUser: new Types.ObjectId(organizerUserId) })
      .populate('customer', 'name')
      .sort({ lastMessageAt: -1, createdAt: -1 })
      .exec();

    return rows.map((row) => {
      const customer = row.customer as unknown as { name?: string };
      const name = customer?.name?.trim() || 'A customer';
      return this.toView(row, 'organizer', name, initialsOf(name), '#1a2e5a');
    });
  }

  /**
   * The messages in one thread, oldest first.
   *
   * Reading a thread marks the reader's side read — opening it is what "seen"
   * means, and a separate call to say so would leave the badge wrong whenever
   * that call was the one that failed.
   */
  async messages(userId: string, conversationId: string): Promise<MessageView[]> {
    const { conversation, side } = await this.owned(userId, conversationId);

    const rows = await this.messageModel
      .find({ conversation: conversation._id })
      .sort({ createdAt: 1 })
      .limit(PAGE_SIZE)
      .exec();

    await this.markRead(conversation, side);

    return rows.map((row) => ({
      id: row._id.toString(),
      sender: row.sender,
      text: row.text,
      createdAt: row.createdAt,
    }));
  }

  /**
   * Posts a message into a thread the caller is part of.
   *
   * The sender's role is derived from which side of the conversation they are
   * on, never taken from the request — otherwise a customer could post a
   * message that renders as though the organizer had written it.
   */
  async send(userId: string, conversationId: string, text: string): Promise<MessageView> {
    const { conversation, side } = await this.owned(userId, conversationId);
    const trimmed = text.trim();

    const message = await this.messageModel.create({
      conversation: conversation._id,
      sender: side === 'customer' ? MessageSender.CUSTOMER : MessageSender.ORGANIZER,
      senderUser: new Types.ObjectId(userId),
      text: trimmed,
    });

    // The preview and the other side's badge move together with the write.
    await this.conversationModel
      .findByIdAndUpdate(conversation._id, {
        lastMessageText: trimmed.slice(0, 200),
        lastMessageAt: new Date(),
        $inc: side === 'customer' ? { organizerUnread: 1 } : { customerUnread: 1 },
      })
      .exec();

    await this.notifyOtherSide(conversation, side, trimmed);
    if (side === 'organizer') await this.refreshReplyTime(conversation.organizer);

    return {
      id: message._id.toString(),
      sender: message.sender,
      text: message.text,
      createdAt: message.createdAt,
    };
  }

  /** Unread messages across every thread — the tab badge. */
  async unreadCount(userId: string): Promise<{ unread: number }> {
    const id = new Types.ObjectId(userId);
    const [row] = await this.conversationModel
      .aggregate<{ unread: number }>([
        { $match: { $or: [{ customer: id }, { organizerUser: id }] } },
        {
          $group: {
            _id: null,
            unread: {
              $sum: {
                $cond: [{ $eq: ['$customer', id] }, '$customerUnread', '$organizerUnread'],
              },
            },
          },
        },
      ])
      .exec();
    return { unread: row?.unread ?? 0 };
  }

  // ---------------------------------------------------------------------------

  /**
   * The conversation, and which side of it the caller is on.
   *
   * Every read and write goes through here. A thread the caller is on neither
   * side of is a 403, so a guessed conversation id reveals nothing.
   */
  private async owned(
    userId: string,
    conversationId: string,
  ): Promise<{ conversation: ConversationDocument; side: Side }> {
    this.assertObjectId(conversationId, 'conversation');
    const conversation = await this.conversationModel.findById(conversationId).exec();
    if (!conversation) throw new NotFoundException('Conversation not found');

    if (conversation.customer.toString() === userId) return { conversation, side: 'customer' };
    if (conversation.organizerUser.toString() === userId)
      return { conversation, side: 'organizer' };
    throw new ForbiddenException('This conversation is not yours');
  }

  /**
   * Recomputes how long this organizer actually takes to reply.
   *
   * The profile's `responseHours` is a schema default of 24 that nothing in the
   * codebase has ever written, so it says nothing about any particular
   * organizer. This measures the thing itself: in each thread, the gap between
   * a customer's message and the organizer's next one, taken as a median so a
   * single overnight reply cannot drag the figure the way a mean would.
   *
   * Only the first customer message of a run is counted — three questions in a
   * row answered once is one reply, not three, and counting each would make an
   * organizer look faster the more they were pestered.
   *
   * Best-effort: a message that is already stored must not fail because a
   * statistic about it could not be recalculated.
   */
  private async refreshReplyTime(organizerId: Types.ObjectId): Promise<void> {
    try {
      const conversations = await this.conversationModel
        .find({ organizer: organizerId })
        .select('_id')
        .sort({ lastMessageAt: -1 })
        .limit(REPLY_THREAD_LIMIT)
        .exec();
      if (conversations.length === 0) return;

      const rows = await this.messageModel
        .find({ conversation: { $in: conversations.map((c) => c._id) } })
        .select('conversation sender createdAt')
        .sort({ conversation: 1, createdAt: 1 })
        .limit(REPLY_MESSAGE_LIMIT)
        .exec();

      const latencies: number[] = [];
      let thread = '';
      let waitingSince: number | null = null;

      for (const row of rows) {
        const key = row.conversation.toString();
        if (key !== thread) {
          thread = key;
          waitingSince = null;
        }
        const at = row.createdAt?.getTime();
        if (at === undefined) continue;

        if (row.sender === MessageSender.CUSTOMER) {
          // The start of a wait, not a new one if the customer is still talking.
          if (waitingSince === null) waitingSince = at;
        } else if (waitingSince !== null) {
          latencies.push(Math.max(0, Math.round((at - waitingSince) / 60000)));
          waitingSince = null;
        }
      }

      await this.organizerModel
        .findByIdAndUpdate(organizerId, {
          replyMedianMinutes: median(latencies),
          replySamples: latencies.length,
        })
        .exec();
    } catch {
      // The message is stored; the statistic about it can wait for the next send.
    }
  }

  private async markRead(conversation: ConversationDocument, side: Side): Promise<void> {
    const field = side === 'customer' ? 'customerUnread' : 'organizerUnread';
    if ((conversation[field] ?? 0) === 0) return;
    await this.conversationModel.findByIdAndUpdate(conversation._id, { [field]: 0 }).exec();
  }

  /**
   * Tells the other party there is something to read.
   *
   * Best-effort: a notification that cannot be written must not lose the
   * message that was already stored, so the failure is swallowed rather than
   * failing the send the sender has already seen succeed.
   */
  private async notifyOtherSide(
    conversation: ConversationDocument,
    side: Side,
    text: string,
  ): Promise<void> {
    const recipient = side === 'customer' ? conversation.organizerUser : conversation.customer;
    try {
      await this.notificationService.create(
        recipient.toString(),
        'New message',
        text.slice(0, 120),
        NotificationType.MESSAGE,
        `/chat/${conversation._id.toString()}`,
      );
    } catch {
      // The message is stored; the nudge about it is not worth failing on.
    }
  }

  private toView(
    conversation: ConversationDocument,
    side: Side,
    withName: string,
    withInitials: string,
    withAvatarColor: string,
    reply: { medianMinutes?: number; samples?: number } = {},
  ): ConversationView {
    return {
      id: conversation._id.toString(),
      withName,
      withInitials,
      withAvatarColor: withAvatarColor || '#1a2e5a',
      organizerId: conversation.organizer.toString(),
      lastMessageText: conversation.lastMessageText ?? '',
      lastMessageAt: conversation.lastMessageAt ?? null,
      unread:
        (side === 'customer' ? conversation.customerUnread : conversation.organizerUnread) ?? 0,
      // Only the customer is looking at an organizer. An organizer reading
      // their own inbox is not owed a stat about the customer.
      replyMedianMinutes: side === 'customer' ? (reply.medianMinutes ?? 0) : 0,
      replySamples: side === 'customer' ? (reply.samples ?? 0) : 0,
    };
  }

  private assertObjectId(id: string, subject: 'organizer' | 'conversation'): void {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(
        subject === 'organizer' ? 'Organizer not found' : 'Conversation not found',
      );
    }
  }
}

/** The middle value — a median, so one overnight reply cannot skew the figure. */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/** Two letters from whatever name we have — never a blank monogram. */
function initialsOf(name: string): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '·';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
