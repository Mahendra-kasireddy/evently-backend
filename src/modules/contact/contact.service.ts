import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  ContactRequest,
  ContactRequestDocument,
  ContactStatus,
  ContactSubject,
} from './schemas/contact-request.schema';
import { CreateContactRequestDto } from './dto/create-contact-request.dto';
import { ListContactRequestsDto } from './dto/list-contact-requests.dto';
import { RespondContactRequestDto } from './dto/respond-contact-request.dto';
import { PaginatedResult } from '../../common/dto/pagination.dto';
import { NotificationService } from '../notification/notification.service';
import { NotificationType } from '../notification/schemas/notification.schema';
import { UserService } from '../user/user.service';
import { SupportMailProvider } from './providers/support-mail.provider';

/** Human-facing labels — one vocabulary for the form, the admin queue and mail. */
export const SUBJECT_LABEL: Record<ContactSubject, string> = {
  [ContactSubject.GENERAL]: 'General enquiry',
  [ContactSubject.EVENT_PLANNING]: 'Event planning',
  [ContactSubject.ORGANIZER]: 'Organizer',
  [ContactSubject.BOOKING]: 'Booking',
  [ContactSubject.BILLING]: 'Payment / Billing',
  [ContactSubject.TECHNICAL]: 'Technical issue',
  [ContactSubject.OTHER]: 'Other',
};

export const STATUS_LABEL: Record<ContactStatus, string> = {
  [ContactStatus.NEW]: 'New',
  [ContactStatus.IN_PROGRESS]: 'In progress',
  [ContactStatus.RESPONDED]: 'Responded',
  [ContactStatus.CLOSED]: 'Closed',
};

/** What the customer gets back — deliberately thin. */
export interface ContactReceipt {
  id: string;
  status: ContactStatus;
  createdAt: Date;
}

@Injectable()
export class ContactService {
  private readonly logger = new Logger(ContactService.name);

  constructor(
    @InjectModel(ContactRequest.name)
    private readonly contactModel: Model<ContactRequestDocument>,
    private readonly notificationService: NotificationService,
    private readonly userService: UserService,
    private readonly supportMail: SupportMailProvider,
  ) {}

  // ---------------------------------------------------------------------------
  // Customer
  // ---------------------------------------------------------------------------

  /**
   * File a support request.
   *
   * `userId` comes from the verified access token or is absent entirely — it is
   * never read from the request body, so a caller cannot attribute their message
   * to another account.
   */
  async create(dto: CreateContactRequestDto, userId?: string): Promise<ContactReceipt> {
    const created = await this.contactModel.create({
      user: userId ? new Types.ObjectId(userId) : null,
      name: dto.name,
      email: dto.email,
      phone: dto.phone,
      subject: dto.subject,
      message: dto.message,
      status: ContactStatus.NEW,
    });

    this.logger.log(
      `Contact request ${created._id.toString()} received (${dto.subject}, ${userId ? 'account' : 'guest'})`,
    );

    // A signed-in customer gets an in-app receipt through the existing
    // notification system. A guest has nowhere to receive one, which is part
    // of why the form itself has to confirm clearly.
    if (userId) {
      await this.safeNotify(
        userId,
        'We received your message',
        `Your ${SUBJECT_LABEL[dto.subject].toLowerCase()} request has reached the Evently support team.`,
      );
    }

    return {
      id: created._id.toString(),
      status: created.status,
      createdAt: created.createdAt ?? new Date(),
    };
  }

  /** Name, email and phone on file, so a signed-in customer types less. */
  async prefillFor(userId: string): Promise<{ name: string; email: string; phone: string }> {
    const user = await this.userService.findById(userId);
    return {
      name: user.name ?? '',
      email: user.email ?? '',
      phone: user.phone ?? '',
    };
  }

  // ---------------------------------------------------------------------------
  // Admin
  // ---------------------------------------------------------------------------

  async list(query: ListContactRequestsDto): Promise<PaginatedResult<Record<string, unknown>>> {
    const filter: Record<string, unknown> = {};
    if (query.status) filter.status = query.status;
    if (query.subject) filter.subject = query.subject;

    const search = query.search?.trim();
    if (search) {
      // Escaped: a customer's name can legitimately contain regex characters,
      // and an unescaped one would either error or match far too much.
      const safe = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const rx = new RegExp(safe, 'i');
      filter.$or = [{ name: rx }, { email: rx }, { phone: rx }];
    }

    const [rows, total] = await Promise.all([
      this.contactModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(query.skip)
        .limit(query.limit)
        .exec(),
      this.contactModel.countDocuments(filter).exec(),
    ]);

    return {
      data: rows.map((r) => this.rowView(r)),
      meta: {
        total,
        page: query.page,
        limit: query.limit,
        pages: Math.max(1, Math.ceil(total / query.limit)),
      },
    };
  }

  /** Per-status totals for the filter chips — real counts, never estimated. */
  async counts(): Promise<Record<string, number>> {
    const grouped = await this.contactModel
      .aggregate<{
        _id: ContactStatus;
        n: number;
      }>([{ $group: { _id: '$status', n: { $sum: 1 } } }])
      .exec();

    const counts: Record<string, number> = { all: 0 };
    for (const status of Object.values(ContactStatus)) counts[status] = 0;
    for (const g of grouped) {
      counts[g._id] = g.n;
      counts.all += g.n;
    }
    return counts;
  }

  async detail(id: string): Promise<Record<string, unknown>> {
    const request = await this.load(id);
    return this.detailView(request);
  }

  async updateStatus(id: string, status: ContactStatus): Promise<Record<string, unknown>> {
    const request = await this.load(id);
    request.status = status;
    await request.save();
    return this.detailView(request);
  }

  /**
   * Save the support team's reply and tell the customer.
   *
   * The reply is persisted first and unconditionally: whether the email leaves
   * the building is a separate question, recorded on `responseEmailed`, and a
   * missing mail provider must not lose the answer an admin just wrote.
   */
  async respond(
    id: string,
    dto: RespondContactRequestDto,
    adminUserId: string,
  ): Promise<Record<string, unknown>> {
    const request = await this.load(id);

    request.response = dto.response;
    request.respondedBy = new Types.ObjectId(adminUserId);
    request.respondedAt = new Date();
    request.status = ContactStatus.RESPONDED;
    await request.save();

    // In-app delivery is real for a customer with an account.
    if (request.user) {
      await this.safeNotify(
        request.user.toString(),
        'Evently support replied',
        dto.response.length > 160 ? `${dto.response.slice(0, 157)}…` : dto.response,
        '/contact',
      );
    }

    const emailed = await this.supportMail.sendResponse(
      request.email,
      `Re: ${SUBJECT_LABEL[request.subject]} — Evently support`,
      dto.response,
    );
    if (emailed !== request.responseEmailed) {
      request.responseEmailed = emailed;
      await request.save();
    }

    return this.detailView(request);
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async load(id: string): Promise<ContactRequestDocument> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Contact request not found');
    const request = await this.contactModel.findById(id).exec();
    if (!request) throw new NotFoundException('Contact request not found');
    return request;
  }

  /** A notification failure must never fail the request that triggered it. */
  private async safeNotify(
    userId: string,
    title: string,
    body: string,
    link = '/contact',
  ): Promise<void> {
    try {
      await this.notificationService.create(userId, title, body, NotificationType.SYSTEM, link);
    } catch (err) {
      this.logger.warn(`Contact notification failed for ${userId}: ${String(err)}`);
    }
  }

  private rowView(r: ContactRequestDocument): Record<string, unknown> {
    return {
      id: r._id.toString(),
      name: r.name,
      email: r.email,
      phone: r.phone,
      subject: r.subject,
      subjectLabel: SUBJECT_LABEL[r.subject] ?? r.subject,
      status: r.status,
      statusLabel: STATUS_LABEL[r.status] ?? r.status,
      isGuest: !r.user,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }

  private detailView(r: ContactRequestDocument): Record<string, unknown> {
    return {
      ...this.rowView(r),
      message: r.message,
      /*
       * Coerced rather than passed through: the admin console distinguishes
       * "no reply yet" from "replied", and it should do that on a value the
       * API always sends, not on whether a particular document happens to
       * carry the field.
       */
      response: r.response ?? '',
      respondedAt: r.respondedAt ?? null,
      responseEmailed: r.responseEmailed ?? false,
      /*
       * The admin's identity stays inside the console. The customer-facing
       * reply is signed "Evently support", so nothing here leaks a staff
       * member's account to the person who wrote in.
       */
      respondedBy: r.respondedBy ? r.respondedBy.toString() : null,
    };
  }
}
