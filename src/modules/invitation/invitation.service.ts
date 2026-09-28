import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  BlockOwner,
  Invitation,
  InvitationDocument,
  InvitationStatus,
  InvitationStoryCard,
  InvitationSubEvent,
  SubEventVisibility,
} from './schemas/invitation.schema';
import { Booking, BookingDocument } from '../booking/schemas/booking.schema';
import { OrganizerService } from '../organizer/organizer.service';
import { NotificationService } from '../notification/notification.service';
import { NotificationType } from '../notification/schemas/notification.schema';
import { InvitationSubEventDto, UpdateInvitationDto } from './dto/update-invitation.dto';
import { storyView } from './story.view';
import { countdownTargetOf } from './countdown';
import { PersonalizeBlockDto } from './dto/personalize-block.dto';
import { RequestChangeDto } from './dto/request-change.dto';
import {
  CARD_PALETTE,
  BLOCK_TYPE_BY_KEY,
  BlockType,
  DEFAULT_BLOCKS,
  DEFAULT_EYEBROW,
  DEFAULT_JOINER,
  DEFAULT_SUB_EVENT_MINUTES,
  DEFAULT_TEMPLATE_ID,
  STORY_CAPTION_MAX,
  STORY_MAX_CARDS,
  HERO_VIDEO_MAX_SECONDS,
  INVITATION_FONTS,
  INVITATION_TEMPLATES,
  RSVP_LEAD_DAYS,
  WELCOME_MESSAGE_MAX,
} from './invitation-defaults';

const pad = (n: number): string => String(n).padStart(2, '0');

/**
 * Where a notification about the invitation should drop the customer.
 *
 * The invitation lives inside My Events, under the booking it belongs to, so
 * the customer lands on the event they already have context for rather than on
 * a standalone screen that has to work out which booking was meant.
 */
function customerInvitationLink(bookingId: string): string {
  return `/workspace/booked/${bookingId}/invitation`;
}

/** `Date` → `yyyy-mm-dd` in UTC, matching how booking dates are stored. */
function isoDay(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** `Date` → `HH:mm` in UTC; '' when the booking carries no time of day. */
function isoTime(d: Date): string {
  const value = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  return value === '00:00' ? '' : value;
}

/** `yyyy-mm-dd` shifted back by `days`, or '' when there is no event date. */
function daysBefore(day: string, days: number): string {
  if (!day) return '';
  const d = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return '';
  d.setUTCDate(d.getUTCDate() - days);
  return isoDay(d);
}

/**
 * Guest invitations (P-15). One invitation per booking, assembled by the
 * organizer and signed off by the customer — only an approved invitation has
 * a live guest link.
 */
/** One row per invitation the customer can see — enough to identify it. */
export interface InvitationSummary {
  bookingId: string;
  status: string;
  bookingTitle: string;
  bookingRef: string;
  occasion: string;
  eventDate: Date | null;
  sentAt: Date | null;
  approvedAt: Date | null;
}

@Injectable()
export class InvitationService {
  private readonly logger = new Logger(InvitationService.name);

  constructor(
    @InjectModel(Invitation.name)
    private readonly invitationModel: Model<InvitationDocument>,
    @InjectModel(Booking.name)
    private readonly bookingModel: Model<BookingDocument>,
    private readonly organizerService: OrganizerService,
    private readonly notificationService: NotificationService,
  ) {}

  /** Templates the builder offers — a product decision, served from one place. */
  templates() {
    return INVITATION_TEMPLATES;
  }

  // ---------------------------------------------------------------------------
  // Organizer side
  // ---------------------------------------------------------------------------

  /** The organizer's own invitation for a booking, created on first open. */
  async getForOrganizer(userId: string, bookingId: string): Promise<Record<string, unknown>> {
    const booking = await this.organizerBooking(userId, bookingId);
    const invitation = await this.findOrCreate(booking);
    return this.view(invitation, booking);
  }

  /**
   * Partial update. Editing an already-approved invitation returns it to
   * draft: the customer approved specific wording, so changing it has to be
   * re-sent and re-approved before the guest link goes live again.
   */
  async updateForOrganizer(
    userId: string,
    bookingId: string,
    dto: UpdateInvitationDto,
  ): Promise<Record<string, unknown>> {
    const booking = await this.organizerBooking(userId, bookingId);
    const invitation = await this.findOrCreate(booking);

    if (dto.details) {
      invitation.details = { ...invitation.details, ...dto.details };
      invitation.markModified('details');
    }
    if (dto.blocks) {
      /*
       * Approval is the customer's and is not in this DTO, so it is carried
       * over per key rather than reset: an organizer touching the wording of
       * one section must not silently un-approve the nine the customer has
       * already signed off. A key that was not there before starts unapproved,
       * which is correct — nobody has seen it.
       */
      const approvedKeys = new Set(invitation.blocks.filter((b) => b.approved).map((b) => b.key));
      invitation.blocks = dto.blocks.map((b) => ({
        key: b.key,
        /* The client does not choose a block's kind — the catalogue does. */
        type: BLOCK_TYPE_BY_KEY[b.key] ?? BlockType.GENERIC,
        title: b.title,
        icon: b.icon,
        owner: b.owner,
        hidden: b.hidden,
        heading: b.heading ?? '',
        body: b.body ?? '',
        approved: approvedKeys.has(b.key),
      }));
      invitation.markModified('blocks');
    }
    /*
     * Mapped field by field rather than spread, so a client cannot smuggle a
     * property the DTO does not declare into a stored subdocument. Array order
     * is the display order and is preserved exactly as sent.
     */
    if (dto.subEvents) {
      /*
       * Ids the invitation already owns, so an edit can keep them.
       *
       * The list is replaced wholesale, which without this would mint a new
       * `_id` for every card on every save — and `details.countdownSubEventId`
       * points at one of those ids, so editing a venue would silently unhook
       * the countdown. An id is honoured only if it is in this set: anything
       * else is a card the client is adding, whatever it claims.
       */
      const ownIds = new Set(
        invitation.subEvents.map((e) => (e as { _id?: Types.ObjectId })._id?.toString() ?? ''),
      );
      /* The cards as they stand, by id, so a save can tell what changed. */
      const before = new Map(
        invitation.subEvents.map((e) => [
          (e as { _id?: Types.ObjectId })._id?.toString() ?? '',
          e,
        ]),
      );
      invitation.subEvents = dto.subEvents.map((e) => ({
        ...(e.id && ownIds.has(e.id) ? { _id: new Types.ObjectId(e.id) } : {}),
        name: e.name,
        eventDate: e.eventDate ?? '',
        eventTime: e.eventTime ?? '',
        endTime: e.endTime ?? '',
        timezone: e.timezone ?? invitation.details.timezone,
        venueName: e.venueName ?? '',
        venueAddress: e.venueAddress ?? '',
        dressCode: e.dressCode ?? '',
        note: e.note ?? '',
        colour: e.colour ?? '',
        visibility: e.visibility ?? SubEventVisibility.ALL_GUESTS,
        /* Kept only where it means something. A card that reaches everyone
           carrying a list of groups is a rule nobody can see and nobody
           edited — it would resurface the moment the card was retargeted. */
        groups: e.visibility === SubEventVisibility.GROUPS ? (e.groups ?? []) : [],
        ...liveFieldsFor(e, e.id ? before.get(e.id) : undefined),
      })) as InvitationSubEvent[];
      invitation.markModified('subEvents');
    }
    /*
     * The story, replacing whatever was stored. Mapped field by field like the
     * sub-events above, and re-numbered from the array the organizer sent: the
     * order they arranged is the order of the list, so deriving `order` from
     * it is the only way the two cannot disagree. A client that sends its own
     * numbering does not get to keep it.
     */
    if (dto.storyCards) {
      invitation.storyCards = dto.storyCards.map((c, index) => ({
        imageUrl: c.imageUrl,
        imageKey: c.imageKey ?? '',
        caption: (c.caption ?? '').trim(),
        order: index,
      })) as InvitationStoryCard[];
      invitation.markModified('storyCards');
    }
    /*
     * The countdown's target has to be one of *this* invitation's sub-events.
     *
     * Checked after the sub-events are applied, because one PATCH may add a
     * card and point the countdown at it in the same breath. An id that names
     * nothing here is rejected rather than quietly ignored: a countdown
     * pointing at another event's ceremony would be a cross-event read, and
     * one pointing at nothing would be a blank block nobody configured.
     */
    if (dto.details?.countdownSubEventId) {
      const known = invitation.subEvents.some(
        (e) => (e as { _id?: Types.ObjectId })._id?.toString() === dto.details?.countdownSubEventId,
      );
      if (!known) {
        throw new BadRequestException('That event is not part of this invitation');
      }
    }
    if (invitation.status === InvitationStatus.APPROVED) {
      invitation.status = InvitationStatus.DRAFT;
      invitation.approvedAt = undefined;
    }

    await invitation.save();
    return this.view(invitation, booking);
  }

  /** Hand the invitation to the customer for approval. */
  async sendToCustomer(userId: string, bookingId: string): Promise<Record<string, unknown>> {
    const booking = await this.organizerBooking(userId, bookingId);
    const invitation = await this.findOrCreate(booking);

    invitation.status = InvitationStatus.SENT;
    invitation.sentAt = new Date();
    invitation.approvedAt = undefined;
    await invitation.save();

    await this.notify(
      booking.customer,
      'Your guest invitation is ready to review',
      `${booking.title} — approve it to make the guest link live.`,
      customerInvitationLink(booking._id.toString()),
    );
    return this.view(invitation, booking);
  }

  /**
   * Clear a change request the organizer has dealt with. Kept separate from
   * `updateForOrganizer` so resolving an ask never implicitly edits content.
   */
  async resolveChangeRequest(
    userId: string,
    bookingId: string,
    requestId: string,
  ): Promise<Record<string, unknown>> {
    const booking = await this.organizerBooking(userId, bookingId);
    const invitation = await this.findOrCreate(booking);

    const request = invitation.changeRequests.find(
      (r) => (r as { _id?: Types.ObjectId })._id?.toString() === requestId,
    );
    if (!request) throw new NotFoundException('Change request not found');

    request.resolved = true;
    invitation.markModified('changeRequests');
    await invitation.save();
    return this.view(invitation, booking);
  }

  // ---------------------------------------------------------------------------
  // Customer side
  // ---------------------------------------------------------------------------

  /** The customer's view of their own invitation — only once it has been sent. */
  /**
   * Every invitation shared with this customer, as `{ bookingId, status }`.
   *
   * My Events needs to know which bookings are waiting on the customer to
   * approve an invitation before it can decide which tab each event belongs
   * in. One query for the whole list, rather than one request per card.
   * Drafts are excluded — the customer cannot see them.
   */
  async listForCustomer(userId: string): Promise<InvitationSummary[]> {
    const invitations = await this.invitationModel
      .find({
        customer: new Types.ObjectId(userId),
        status: { $ne: InvitationStatus.DRAFT },
      })
      .select('booking status sentAt approvedAt')
      /*
       * The booking names the invitation. Without it every row in a list reads
       * "Guest invitation" and the customer cannot tell one from another —
       * this list originally served only My Events' tab logic, which needed
       * nothing but the id and the status.
       */
      .populate('booking', 'title ref occasion eventDate')
      .exec();

    return invitations.map((i) => {
      const booking = i.booking as unknown as {
        _id: Types.ObjectId;
        title?: string;
        ref?: string;
        occasion?: string;
        eventDate?: Date;
      };
      return {
        bookingId: booking._id.toString(),
        status: i.status,
        bookingTitle: booking.title ?? '',
        bookingRef: booking.ref ?? '',
        occasion: booking.occasion ?? '',
        eventDate: booking.eventDate ?? null,
        sentAt: i.sentAt ?? null,
        approvedAt: i.approvedAt ?? null,
      };
    });
  }

  async getForCustomer(userId: string, bookingId: string): Promise<Record<string, unknown>> {
    const booking = await this.customerBooking(userId, bookingId);
    const invitation = await this.sharedInvitation(booking);
    return this.view(invitation, booking);
  }

  /**
   * One section signed off.
   *
   * The guest link goes live only when the last visible section is approved —
   * a hidden block is not shown to guests, so waiting on it would block the
   * invitation on something nobody will read.
   */
  async approveBlock(
    userId: string,
    bookingId: string,
    blockKey: string,
  ): Promise<Record<string, unknown>> {
    const booking = await this.customerBooking(userId, bookingId);
    const invitation = await this.sharedInvitation(booking);

    const block = invitation.blocks.find((b) => b.key === blockKey);
    if (!block) throw new NotFoundException('That section is not on this invitation');

    block.approved = true;

    const outstanding = invitation.blocks.filter((b) => !b.hidden && !b.approved);
    if (outstanding.length === 0 && invitation.status !== InvitationStatus.APPROVED) {
      invitation.status = InvitationStatus.APPROVED;
      invitation.approvedAt = new Date();
      await invitation.save();

      const organizerUserId = await this.organizerUserId(invitation.organizer);
      await this.notify(
        organizerUserId,
        'Invitation approved',
        `${booking.title} — the guest link is live.`,
        `/organizer/invitation/${booking._id.toString()}`,
      );
      return this.view(invitation, booking);
    }

    await invitation.save();
    return this.view(invitation, booking);
  }

  /** Customer sign-off — this, and only this, makes the guest link live. */
  async approve(userId: string, bookingId: string): Promise<Record<string, unknown>> {
    const booking = await this.customerBooking(userId, bookingId);
    const invitation = await this.sharedInvitation(booking);

    // Approving the invitation is approving every section of it.
    invitation.blocks.forEach((b) => {
      b.approved = true;
    });
    invitation.status = InvitationStatus.APPROVED;
    invitation.approvedAt = new Date();
    await invitation.save();

    const organizerUserId = await this.organizerUserId(invitation.organizer);
    await this.notify(
      organizerUserId,
      'Invitation approved',
      `${booking.title} — the guest link is live.`,
      `/organizer/invitation/${booking._id.toString()}`,
    );
    return this.view(invitation, booking);
  }

  /**
   * The customer editing one of their own sections.
   *
   * Ownership is checked per block, not per invitation: the customer writes the
   * personal sections (names, story, photos) and the organizer keeps the
   * logistics ones, so editing someone else's section is a 403 rather than a
   * silently ignored field. Their own edit does not reset approval — they are
   * the approver, so there is nothing to re-approve.
   */
  async personalizeBlock(
    userId: string,
    bookingId: string,
    blockKey: string,
    dto: PersonalizeBlockDto,
  ): Promise<Record<string, unknown>> {
    const booking = await this.customerBooking(userId, bookingId);
    const invitation = await this.sharedInvitation(booking);

    const block = invitation.blocks.find((b) => b.key === blockKey);
    if (!block) throw new NotFoundException('That section is not part of this invitation');
    if (block.owner !== BlockOwner.CUSTOMER) {
      throw new ForbiddenException(
        'Your organizer looks after this section — ask them for a change instead',
      );
    }

    if (dto.heading !== undefined) block.heading = dto.heading;
    if (dto.body !== undefined) block.body = dto.body;
    if (dto.hidden !== undefined) block.hidden = dto.hidden;
    invitation.markModified('blocks');
    await invitation.save();

    return this.view(invitation, booking);
  }

  /**
   * The customer asking for a change to a section the organizer owns. Recorded
   * on the invitation *and* notified, so the ask survives the notification
   * being dismissed.
   */
  async requestChange(
    userId: string,
    bookingId: string,
    dto: RequestChangeDto,
  ): Promise<Record<string, unknown>> {
    const booking = await this.customerBooking(userId, bookingId);
    const invitation = await this.sharedInvitation(booking);

    let blockTitle = '';
    if (dto.blockKey) {
      const block = invitation.blocks.find((b) => b.key === dto.blockKey);
      if (!block) throw new NotFoundException('That section is not part of this invitation');
      blockTitle = block.title;
    }

    invitation.changeRequests.push({
      blockKey: dto.blockKey ?? '',
      blockTitle,
      note: dto.note,
      at: new Date(),
      resolved: false,
    });
    invitation.markModified('changeRequests');
    await invitation.save();

    const organizerUserId = await this.organizerUserId(invitation.organizer);
    await this.notify(
      organizerUserId,
      blockTitle ? `Change requested: ${blockTitle}` : 'Invitation change requested',
      `${booking.title} — ${dto.note}`,
      `/organizer/invitation/${booking._id.toString()}`,
    );
    return this.view(invitation, booking);
  }

  // ---------------------------------------------------------------------------
  // internals
  // ---------------------------------------------------------------------------

  /** Booking that belongs to the calling organizer, or 403/404. */
  private async organizerBooking(userId: string, bookingId: string): Promise<BookingDocument> {
    if (!Types.ObjectId.isValid(bookingId)) throw new NotFoundException('Booking not found');
    const profile = await this.organizerService.findByUser(userId);
    if (!profile) {
      throw new ForbiddenException('No organizer profile is linked to your account');
    }
    const booking = await this.bookingModel.findById(bookingId).exec();
    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.organizer?.toString() !== profile._id.toString()) {
      throw new ForbiddenException('This booking belongs to another organizer');
    }
    return booking;
  }

  /** Booking that belongs to the calling customer, or 403/404. */
  private async customerBooking(userId: string, bookingId: string): Promise<BookingDocument> {
    if (!Types.ObjectId.isValid(bookingId)) throw new NotFoundException('Booking not found');
    const booking = await this.bookingModel.findById(bookingId).exec();
    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.customer.toString() !== userId) {
      throw new ForbiddenException('This booking belongs to another customer');
    }
    return booking;
  }

  /**
   * The invitation as the customer is allowed to see it.
   *
   * A draft is the organizer's private working copy, so it is a 404 rather than
   * a 403 — from the customer's side nothing has been shared yet, which is the
   * normal early state their screen renders as "still being prepared".
   */
  private async sharedInvitation(booking: BookingDocument): Promise<InvitationDocument> {
    const invitation = await this.invitationModel.findOne({ booking: booking._id }).exec();
    if (!invitation || invitation.status === InvitationStatus.DRAFT) {
      throw new NotFoundException('No invitation has been shared with you for this event yet');
    }
    return invitation;
  }

  /**
   * The invitation for a booking, seeded from the booking itself the first
   * time the organizer opens it — no invented content, just what the booking
   * already knows: date, time and venue.
   */
  private async findOrCreate(booking: BookingDocument): Promise<InvitationDocument> {
    const existing = await this.invitationModel.findOne({ booking: booking._id }).exec();
    if (existing) return existing;

    const eventDate = booking.eventDate ? isoDay(booking.eventDate) : '';
    return this.invitationModel.create({
      booking: booking._id,
      organizer: booking.organizer,
      customer: booking.customer,
      status: InvitationStatus.DRAFT,
      details: {
        template: DEFAULT_TEMPLATE_ID,
        eyebrow: DEFAULT_EYEBROW,
        hostOne: '',
        hostTwo: '',
        joiner: DEFAULT_JOINER,
        eventDate,
        eventTime: booking.eventDate ? isoTime(booking.eventDate) : '',
        /* The booking's own location, seeded once. Putting it in both fields
           printed the same street twice on the invitation. */
        venueName: booking.location ?? '',
        venueAddress: '',
        message: '',
        rsvpEnabled: true,
        rsvpDeadline: daysBefore(eventDate, RSVP_LEAD_DAYS),
        rsvpPlusOnes: true,
      },
      blocks: DEFAULT_BLOCKS.map((b) => ({
        ...b,
        type: BLOCK_TYPE_BY_KEY[b.key] ?? BlockType.GENERIC,
        hidden: false,
        approved: false,
      })),
    });
  }

  /** Wire shape: the invitation plus the booking context the screen shows. */
  private view(invitation: InvitationDocument, booking: BookingDocument): Record<string, unknown> {
    return {
      id: invitation._id.toString(),
      bookingId: booking._id.toString(),
      bookingRef: booking.ref,
      bookingTitle: booking.title,
      occasion: booking.occasion,
      eventDate: booking.eventDate,
      location: booking.location,
      status: invitation.status,
      sentAt: invitation.sentAt ?? null,
      approvedAt: invitation.approvedAt ?? null,
      details: invitation.details,
      /*
       * `approved` is reported true for every block of an already-approved
       * invitation, including the ones stored before the field existed — the
       * customer approved the whole thing, so every section of it is approved.
       */
      blocks: invitation.blocks.map((b) => ({
        key: b.key,
        /* Derived where it was never stored, so a block written before types
           existed still tells the client which renderer it needs. */
        type:
          b.type && b.type !== BlockType.GENERIC
            ? b.type
            : (BLOCK_TYPE_BY_KEY[b.key] ?? BlockType.GENERIC),
        title: b.title,
        icon: b.icon,
        owner: b.owner,
        hidden: b.hidden,
        heading: b.heading,
        body: b.body,
        approved: b.approved || invitation.status === InvitationStatus.APPROVED,
      })),
      /*
       * Ids are surfaced because the builder needs a stable key per card for
       * React and for the calendar entry's UID — array index would change the
       * moment a card is reordered or removed.
       */
      subEvents: invitation.subEvents.map((e) => ({
        id: (e as { _id?: Types.ObjectId })._id?.toString() ?? '',
        name: e.name,
        eventDate: e.eventDate,
        eventTime: e.eventTime,
        endTime: e.endTime,
        timezone: e.timezone,
        venueName: e.venueName,
        venueAddress: e.venueAddress,
        dressCode: e.dressCode,
        note: e.note,
        colour: e.colour,
        visibility: e.visibility,
        groups: e.groups ?? [],
        /* The builder edits these; the guest view decides what to do with
           them. `liveStartedAt` is read-only here — it is the server's. */
        liveEnabled: e.liveEnabled ?? false,
        liveTitle: e.liveTitle ?? '',
        liveUrl: e.liveUrl ?? '',
        live360Url: e.live360Url ?? '',
        liveVrUrl: e.liveVrUrl ?? '',
        liveStartedAt: e.liveStartedAt ? e.liveStartedAt.toISOString() : '',
      })),
      /*
       * The catalogues the editor picks from, served rather than hard-coded in
       * the app: a theme or a font the client invented would fail validation on
       * the way back, so the client is given the set the server will accept.
       */
      /* Read back through `order` rather than in stored position, for the same
         reason it is stored at all. */
      storyCards: storyView(invitation, { withKeys: true }),
      /*
       * What the countdown counts down to, resolved to one absolute instant —
       * the same figure the guest API sends, so the customer reviewing the
       * invitation and their guests are counting to the same moment.
       */
      countdown: countdownTargetOf(invitation),
      templates: INVITATION_TEMPLATES,
      fonts: INVITATION_FONTS,
      limits: {
        welcomeMessage: WELCOME_MESSAGE_MAX,
        heroVideoSeconds: HERO_VIDEO_MAX_SECONDS,
        storyCards: STORY_MAX_CARDS,
        storyCaption: STORY_CAPTION_MAX,
      },
      cardPalette: CARD_PALETTE,
      defaultSubEventMinutes: DEFAULT_SUB_EVENT_MINUTES,
      // Outstanding asks only — a resolved one is history, not a to-do.
      changeRequests: invitation.changeRequests
        .filter((r) => !r.resolved)
        .map((r) => ({
          id: (r as { _id?: Types.ObjectId })._id?.toString() ?? '',
          blockKey: r.blockKey,
          blockTitle: r.blockTitle,
          note: r.note,
          at: r.at,
          resolved: r.resolved,
        })),
    };
  }

  /** User behind an organizer profile, for notifications. */
  private async organizerUserId(profileId: Types.ObjectId): Promise<string | null> {
    try {
      const profile = await this.organizerService.findById(profileId.toString());
      return profile?.user?.toString() ?? null;
    } catch {
      return null;
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
      this.logger.warn(`Invitation notification failed: ${String(err)}`);
    }
  }
}

/**
 * One card's live-stream fields, carried forward across a save.
 *
 * `liveStartedAt` is the part that cannot come from the client: it is the
 * moment the switch went on, and the pop-up and the LIVE banner both key off
 * it. Rebuilding the subdocument would lose it, so a stream that was already
 * on keeps the time it started, a stream just switched on is stamped now, and
 * a stream switched off forgets — so switching it back on later is a new
 * start and not a resumption of an hours-old one.
 */
function liveFieldsFor(
  next: InvitationSubEventDto,
  previous: InvitationSubEvent | undefined,
): Partial<InvitationSubEvent> {
  const url = (next.liveUrl ?? '').trim();
  const enabled = (next.liveEnabled ?? false) && url !== '';
  const wasOn = Boolean(previous?.liveEnabled) && (previous?.liveUrl ?? '').trim() !== '';
  return {
    liveEnabled: enabled,
    liveTitle: (next.liveTitle ?? '').trim(),
    liveUrl: url,
    live360Url: (next.live360Url ?? '').trim(),
    liveVrUrl: (next.liveVrUrl ?? '').trim(),
    ...(enabled
      ? { liveStartedAt: wasOn ? (previous?.liveStartedAt ?? new Date()) : new Date() }
      : {}),
  };
}
