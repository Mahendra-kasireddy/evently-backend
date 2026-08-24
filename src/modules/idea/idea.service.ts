import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  BookingIdea,
  BookingIdeaDocument,
  IdeaApproval,
  IdeaAuthorRole,
  IdeaPlanStatus,
  IdeaType,
} from './schemas/booking-idea.schema';
import { BoardVision, BoardVisionDocument } from './schemas/board-vision.schema';
import { Booking, BookingDocument } from '../booking/schemas/booking.schema';
import { User, UserDocument } from '../user/schemas/user.schema';
import { CreateIdeaDto } from './dto/create-idea.dto';
import { ReplyIdeaDto } from './dto/reply-idea.dto';
import { UpdateVisionDto } from './dto/update-vision.dto';
import { OrganizerService } from '../organizer/organizer.service';
import { NotificationService } from '../notification/notification.service';
import { NotificationType } from '../notification/schemas/notification.schema';

/** The counts the workspace summary line is built from. */
export interface IdeaCounts {
  shared: number;
  planned: number;
  awaitingApproval: number;
}

/** The organizer's short summary of the event, as both sides read it. */
export interface VisionView {
  theme: string;
  vibe: string;
  surprise: string;
  food: string;
  surpriseConfidential: boolean;
  /** False until the organizer has filled in at least one slot. */
  captured: boolean;
}

/** `GET /idea/mine/:bookingId` and `GET /idea/organizer/:bookingId`. */
export interface BoardView {
  items: Record<string, unknown>[];
  counts: IdeaCounts;
  vision: VisionView;
}

/**
 * Ideas & planning board — one thread per booking, between the customer who owns
 * it and the organizer delivering it.
 *
 * The board is where the customer's wishes become the organizer's plan: the
 * customer posts, the organizer replies with a status, and where a decision is
 * needed the organizer marks it as awaiting approval. Nothing is derived or
 * guessed — every count on the workspace comes from these documents.
 */
@Injectable()
export class IdeaService {
  private readonly logger = new Logger(IdeaService.name);

  constructor(
    @InjectModel(BookingIdea.name)
    private readonly ideaModel: Model<BookingIdeaDocument>,
    @InjectModel(Booking.name)
    private readonly bookingModel: Model<BookingDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(BoardVision.name)
    private readonly visionModel: Model<BoardVisionDocument>,
    private readonly organizerService: OrganizerService,
    private readonly notificationService: NotificationService,
  ) {}

  // ---------------------------------------------------------------------------
  // Customer side
  // ---------------------------------------------------------------------------

  /** The board for a booking the caller owns, newest first, plus its counts. */
  async listForCustomer(userId: string, bookingId: string): Promise<BoardView> {
    const booking = await this.customerBooking(userId, bookingId);
    return this.board(booking._id);
  }

  async createForCustomer(
    userId: string,
    bookingId: string,
    dto: CreateIdeaDto,
  ): Promise<Record<string, unknown>> {
    const booking = await this.customerBooking(userId, bookingId);
    const authorName = await this.displayName(userId);

    const idea = await this.ideaModel.create({
      booking: booking._id,
      author: new Types.ObjectId(userId),
      authorRole: IdeaAuthorRole.CUSTOMER,
      authorName,
      // An organizer status note is not something a customer can post.
      type: dto.type && dto.type !== IdeaType.UPDATE ? dto.type : IdeaType.IDEA,
      text: dto.text,
      images: (dto.images ?? []).map((i) => ({
        url: i.url,
        key: i.key ?? '',
        originalName: i.originalName ?? '',
      })),
      confidential: dto.confidential === true,
    });

    await this.notifyOrganizer(
      booking,
      'New idea on the planning board',
      `${authorName || 'Your customer'} shared an idea for ${booking.title}.`,
    );
    return this.view(idea);
  }

  /**
   * Customer sign-off on a reply that asked for one. Only a post actually
   * awaiting approval can be approved — approving conversation would be
   * meaningless, and re-approving is a no-op rather than an error.
   */
  async approve(userId: string, ideaId: string): Promise<Record<string, unknown>> {
    const idea = await this.byId(ideaId);
    const booking = await this.customerBooking(userId, idea.booking.toString());

    if (idea.approval === IdeaApproval.NONE) {
      throw new ForbiddenException('This post is not awaiting your approval');
    }
    if (idea.approval === IdeaApproval.PENDING) {
      idea.approval = IdeaApproval.APPROVED;
      idea.approvedAt = new Date();
      await idea.save();

      await this.notifyOrganizer(
        booking,
        'Approved on the planning board',
        `${idea.approvalLabel || 'An item'} — approved for ${booking.title}.`,
      );
    }
    return this.view(idea);
  }

  // ---------------------------------------------------------------------------
  // Organizer side
  // ---------------------------------------------------------------------------

  async listForOrganizer(userId: string, bookingId: string): Promise<BoardView> {
    const booking = await this.organizerBooking(userId, bookingId);
    return this.board(booking._id);
  }

  /**
   * The organizer recording what they have understood the event to be.
   *
   * Only the organizer writes this — it is their reading of the customer's
   * ideas, which is exactly what makes it worth reading back. Fields left out
   * of the body are untouched; an empty string clears a slot.
   */
  async updateVision(userId: string, bookingId: string, dto: UpdateVisionDto): Promise<BoardView> {
    const booking = await this.organizerBooking(userId, bookingId);
    const vision = await this.visionFor(booking._id);

    if (dto.theme !== undefined) vision.theme = dto.theme;
    if (dto.vibe !== undefined) vision.vibe = dto.vibe;
    if (dto.surprise !== undefined) vision.surprise = dto.surprise;
    if (dto.food !== undefined) vision.food = dto.food;
    if (dto.surpriseConfidential !== undefined) {
      vision.surpriseConfidential = dto.surpriseConfidential;
    }
    await vision.save();

    await this.notifyCustomer(
      booking,
      'Your event vision was updated',
      `${await this.organizerName(booking)} captured what they understood for ${booking.title}.`,
    );
    return this.board(booking._id);
  }

  /** Organizer posts their own status note onto the board. */
  async createForOrganizer(
    userId: string,
    bookingId: string,
    dto: CreateIdeaDto,
  ): Promise<Record<string, unknown>> {
    const booking = await this.organizerBooking(userId, bookingId);
    const authorName = await this.organizerName(booking);

    const idea = await this.ideaModel.create({
      booking: booking._id,
      author: new Types.ObjectId(userId),
      authorRole: IdeaAuthorRole.ORGANIZER,
      authorName,
      // An organizer posts progress or asks the customer something; the
      // wish-list types (idea, inspiration, surprise) are the customer's.
      type: dto.type === IdeaType.QUESTION ? IdeaType.QUESTION : IdeaType.UPDATE,
      text: dto.text,
      images: (dto.images ?? []).map((i) => ({
        url: i.url,
        key: i.key ?? '',
        originalName: i.originalName ?? '',
      })),
    });

    await this.notifyCustomer(
      booking,
      'Planning board update',
      `${authorName} posted an update for ${booking.title}.`,
    );
    return this.view(idea);
  }

  /** Organizer turns a post into a plan, optionally requesting a sign-off. */
  async reply(userId: string, ideaId: string, dto: ReplyIdeaDto): Promise<Record<string, unknown>> {
    const idea = await this.byId(ideaId);
    const booking = await this.organizerBooking(userId, idea.booking.toString());

    idea.reply = { status: dto.status, text: dto.text, at: new Date() };
    if (dto.approvalLabel) {
      // Re-asking after an approval is legitimate (the plan changed), so this
      // deliberately resets an already-approved item back to pending.
      idea.approval = IdeaApproval.PENDING;
      idea.approvalLabel = dto.approvalLabel;
      idea.approvedAt = null;
    }
    await idea.save();

    await this.notifyCustomer(
      booking,
      dto.approvalLabel ? 'Your approval is needed' : 'Your idea is now a plan',
      dto.approvalLabel
        ? `${dto.approvalLabel}`
        : `${await this.organizerName(booking)} replied on the planning board.`,
    );
    return this.view(idea);
  }

  // ---------------------------------------------------------------------------
  // internals
  // ---------------------------------------------------------------------------

  private async board(bookingId: Types.ObjectId): Promise<BoardView> {
    const [docs, vision] = await Promise.all([
      this.ideaModel.find({ booking: bookingId }).sort({ createdAt: -1 }).exec(),
      this.visionModel.findOne({ booking: bookingId }).exec(),
    ]);
    return {
      items: docs.map((d) => this.view(d)),
      counts: this.counts(docs),
      vision: this.visionView(vision),
    };
  }

  /** The vision document for a booking, created empty on first write. */
  private async visionFor(bookingId: Types.ObjectId): Promise<BoardVisionDocument> {
    const existing = await this.visionModel.findOne({ booking: bookingId }).exec();
    if (existing) return existing;
    return this.visionModel.create({ booking: bookingId });
  }

  /**
   * Wire shape for the vision. `captured` is computed rather than stored so the
   * client never has to decide what "empty" means: no slot filled in, no card.
   */
  private visionView(v: BoardVisionDocument | null): VisionView {
    const theme = v?.theme ?? '';
    const vibe = v?.vibe ?? '';
    const surprise = v?.surprise ?? '';
    const food = v?.food ?? '';
    return {
      theme,
      vibe,
      surprise,
      food,
      surpriseConfidential: v?.surpriseConfidential ?? true,
      captured: [theme, vibe, surprise, food].some((s) => s.trim().length > 0),
    };
  }

  /**
   * The three figures both boards show.
   *
   * `shared` and `planned` must count over the SAME population — the customer's
   * own posts — because the client divides one by the other for the planning
   * ring. Counting `planned` over every replied-to document instead included
   * the organizer's own update posts, so an organizer who replied to their own
   * updates produced "5 of 2 ideas turned into tasks" and a ring pinned at
   * 100%. `shared` deliberately excludes organizer status notes: "12 ideas
   * shared" should mean twelve of the customer's.
   */
  private counts(docs: BookingIdeaDocument[]): IdeaCounts {
    const fromCustomer = docs.filter((d) => d.authorRole === IdeaAuthorRole.CUSTOMER);
    return {
      shared: fromCustomer.length,
      planned: fromCustomer.filter((d) => !!d.reply).length,
      awaitingApproval: docs.filter((d) => d.approval === IdeaApproval.PENDING).length,
    };
  }

  private view(d: BookingIdeaDocument): Record<string, unknown> {
    return {
      id: d._id.toString(),
      bookingId: d.booking.toString(),
      authorRole: d.authorRole,
      authorName: d.authorName,
      type: d.type,
      text: d.text,
      images: (d.images ?? []).map((i) => ({
        url: i.url,
        key: i.key,
        originalName: i.originalName,
      })),
      confidential: d.confidential,
      reply: d.reply ? { status: d.reply.status, text: d.reply.text, at: d.reply.at } : null,
      approval: d.approval,
      approvalLabel: d.approvalLabel,
      approvedAt: d.approvedAt,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    };
  }

  private async byId(ideaId: string): Promise<BookingIdeaDocument> {
    if (!Types.ObjectId.isValid(ideaId)) throw new NotFoundException('Post not found');
    const idea = await this.ideaModel.findById(ideaId).exec();
    if (!idea) throw new NotFoundException('Post not found');
    return idea;
  }

  /** Booking owned by the calling customer, or 403/404. */
  private async customerBooking(userId: string, bookingId: string): Promise<BookingDocument> {
    if (!Types.ObjectId.isValid(bookingId)) throw new NotFoundException('Booking not found');
    const booking = await this.bookingModel.findById(bookingId).exec();
    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.customer.toString() !== userId) {
      throw new ForbiddenException('This booking belongs to another customer');
    }
    return booking;
  }

  /** Booking delivered by the calling organizer, or 403/404. */
  private async organizerBooking(userId: string, bookingId: string): Promise<BookingDocument> {
    if (!Types.ObjectId.isValid(bookingId)) throw new NotFoundException('Booking not found');
    const profile = await this.organizerService.findByUser(userId);
    if (!profile) throw new ForbiddenException('No organizer profile is linked to your account');
    const booking = await this.bookingModel.findById(bookingId).exec();
    if (!booking) throw new NotFoundException('Booking not found');
    if (!booking.organizer || booking.organizer.toString() !== profile._id.toString()) {
      throw new ForbiddenException('This booking belongs to another organizer');
    }
    return booking;
  }

  private async displayName(userId: string): Promise<string> {
    try {
      const user = await this.userModel.findById(userId, { name: 1 }).lean().exec();
      return (user?.name ?? '').trim();
    } catch {
      return '';
    }
  }

  private async organizerName(booking: BookingDocument): Promise<string> {
    if (!booking.organizer) return 'Your organizer';
    try {
      const profile = await this.organizerService.findById(booking.organizer.toString());
      return (profile.name ?? '').trim() || 'Your organizer';
    } catch {
      return 'Your organizer';
    }
  }

  private async notifyCustomer(
    booking: BookingDocument,
    title: string,
    body: string,
  ): Promise<void> {
    await this.notify(
      booking.customer,
      title,
      body,
      `/workspace/booked/${booking._id.toString()}/ideas`,
    );
  }

  private async notifyOrganizer(
    booking: BookingDocument,
    title: string,
    body: string,
  ): Promise<void> {
    if (!booking.organizer) return;
    try {
      const profile = await this.organizerService.findById(booking.organizer.toString());
      await this.notify(
        profile.user,
        title,
        body,
        `/organizer/events/${booking._id.toString()}/ideas`,
      );
    } catch (err) {
      this.logger.warn(`Organizer idea notification failed: ${String(err)}`);
    }
  }

  private async notify(
    userId: Types.ObjectId | string | null | undefined,
    title: string,
    body: string,
    link: string,
  ): Promise<void> {
    if (!userId) return;
    try {
      await this.notificationService.create(
        userId.toString(),
        title,
        body,
        NotificationType.BOOKING,
        link,
      );
    } catch (err) {
      this.logger.warn(`Idea notification failed: ${String(err)}`);
    }
  }
}

export { IdeaPlanStatus };
