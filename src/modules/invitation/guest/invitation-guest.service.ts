import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model, Types } from 'mongoose';
import { randomBytes } from 'crypto';
import { Invitation, InvitationDocument, InvitationStatus } from '../schemas/invitation.schema';
import {
  GuestGroup,
  InvitationGuest,
  InvitationGuestDocument,
  ShareStatus,
} from '../schemas/invitation-guest.schema';
import { Booking, BookingDocument } from '../../booking/schemas/booking.schema';
import { storyView } from '../story.view';
import { groupOf, saveTheDateView } from '../save-the-date.view';
import { countdownTargetOf, notificationFor } from '../countdown';
import { liveNotificationFor, liveViewFor } from '../live.view';
import { LIVE_WATCHING_WINDOW_MS, NotificationKind } from '../invitation-defaults';
import {
  BLOCK_TYPE_BY_KEY,
  BlockType,
  CARD_PALETTE,
  DEFAULT_SUB_EVENT_MINUTES,
  INVITATION_TEMPLATES,
} from '../invitation-defaults';
import { AddGuestDto, AddGuestsDto, UpdateGuestDto } from '../dto/add-guest.dto';
import { ShareInvitationDto } from '../dto/share-invitation.dto';
import { PHONE_REJECTION_MESSAGE, displayPhone, parseGuestPhone } from './guest-phone';
import { guestAppUrl, guestShareUrl, shareMessage } from './share-links';
import { WhatsAppProvider } from './whatsapp.provider';

/** A guest as the customer's share dialog sees it. */
export interface GuestSummary {
  id: string;
  name: string;
  phone: string;
  phoneDisplay: string;
  group: GuestGroup;
  /** Section keys already shared with this guest, so the UI can say so. */
  sharedSections: string[];
  lastSharedAt: Date | null;
  viewed: boolean;
}

/** The outcome of sharing with one guest. */
export interface ShareOutcome {
  guest: GuestSummary;
  status: ShareStatus;
  /** In handoff mode the client must open this to finish the send. */
  handoffUrl?: string;
  url: string;
  error?: string;
}

@Injectable()
export class InvitationGuestService {
  constructor(
    @InjectModel(Invitation.name) private readonly invitationModel: Model<InvitationDocument>,
    @InjectModel(InvitationGuest.name)
    private readonly guestModel: Model<InvitationGuestDocument>,
    @InjectModel(Booking.name) private readonly bookingModel: Model<BookingDocument>,
    private readonly config: ConfigService,
    private readonly whatsapp: WhatsAppProvider,
  ) {}

  // ----- customer side -------------------------------------------------

  /**
   * The invitation a customer may share.
   *
   * Only an approved one. A draft or a merely-sent invitation is still being
   * argued over between the organizer and the customer, and a guest link to it
   * would publish wording nobody has signed off.
   */
  private async publishedFor(
    userId: string,
    bookingId: string,
  ): Promise<{ booking: BookingDocument; invitation: InvitationDocument }> {
    if (!Types.ObjectId.isValid(bookingId)) throw new NotFoundException('Booking not found');
    const booking = await this.bookingModel.findById(bookingId).exec();
    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.customer.toString() !== userId) {
      throw new NotFoundException('Booking not found');
    }
    const invitation = await this.invitationModel.findOne({ booking: booking._id }).exec();
    if (!invitation) throw new NotFoundException('No invitation for this event yet');
    if (invitation.status !== InvitationStatus.APPROVED) {
      throw new BadRequestException('Approve the invitation before sharing it with guests');
    }
    return { booking, invitation };
  }

  async listGuests(userId: string, bookingId: string): Promise<GuestSummary[]> {
    const { invitation } = await this.publishedFor(userId, bookingId);
    const guests = await this.guestModel
      .find({ invitation: invitation._id })
      .sort({ createdAt: 1 })
      .exec();
    return guests.map((g) => this.summarise(g));
  }

  /**
   * Adds a guest, or reports the one that already holds this number.
   *
   * A duplicate is a 409 carrying the existing guest rather than a bare error,
   * so the dialog can offer "use Rahul" instead of making the customer work out
   * who already has that number.
   */
  async addGuest(userId: string, bookingId: string, dto: AddGuestDto): Promise<GuestSummary> {
    const { invitation, booking } = await this.publishedFor(userId, bookingId);
    const guest = await this.findOrCreateGuest(
      invitation,
      booking,
      dto.name,
      dto.phone,
      true,
      dto.group,
    );
    return this.summarise(guest);
  }

  /**
   * Several guests in one request — what importing from a phonebook sends.
   *
   * Every entry is attempted, and one bad number does not lose the other
   * nineteen: a phonebook is full of landlines, short codes and half-typed
   * numbers, and refusing the whole import over one of them would make the
   * feature useless on real address books. Each result says which it was, so
   * the screen can name the ones it could not take.
   *
   * A number already on the list resolves to the guest who holds it rather
   * than erroring — importing the same contact twice is the normal way this
   * gets used, and the customer's intent is "have these people on my list".
   */
  async addGuests(
    userId: string,
    bookingId: string,
    dto: AddGuestsDto,
  ): Promise<{ added: GuestSummary[]; skipped: Array<{ name: string; reason: string }> }> {
    const { invitation, booking } = await this.publishedFor(userId, bookingId);

    const added: GuestSummary[] = [];
    const skipped: Array<{ name: string; reason: string }> = [];

    for (const entry of dto.guests) {
      try {
        const guest = await this.findOrCreateGuest(
          invitation,
          booking,
          entry.name,
          entry.phone,
          false,
          entry.group,
        );
        added.push(this.summarise(guest));
      } catch (err) {
        skipped.push({
          name: (entry.name ?? '').trim() || 'This contact',
          reason:
            err instanceof BadRequestException
              ? ((err.getResponse() as { message?: string })?.message ?? 'Could not be added')
              : 'Could not be added',
        });
      }
    }

    return { added, skipped };
  }

  /**
   * Edits a guest already on the list.
   *
   * Changing the number is a real change of identity for a guest — the number
   * is the duplicate key and what the invitation is sent to — so it is checked
   * against the rest of the list the same way adding one is. The share token is
   * deliberately untouched: a link already in somebody's WhatsApp must keep
   * working when their name is corrected.
   */
  async updateGuest(
    userId: string,
    bookingId: string,
    guestId: string,
    dto: UpdateGuestDto,
  ): Promise<GuestSummary> {
    const { invitation } = await this.publishedFor(userId, bookingId);
    if (!Types.ObjectId.isValid(guestId)) throw new NotFoundException('Unknown guest');

    const guest = await this.guestModel
      .findOne({ _id: guestId, invitation: invitation._id })
      .exec();
    if (!guest) throw new NotFoundException('Unknown guest');

    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw new BadRequestException('Enter the guest’s name.');
      guest.name = name;
    }

    if (dto.phone !== undefined) {
      const parsed = parseGuestPhone(
        dto.phone,
        this.config.get<string>('otp.defaultDialCode') ?? '+91',
      );
      if (!parsed.ok) {
        throw new BadRequestException(PHONE_REJECTION_MESSAGE[parsed.reason ?? 'not_a_number']);
      }
      if (parsed.e164 !== guest.phone) {
        const clash = await this.guestModel
          .findOne({ invitation: invitation._id, phone: parsed.e164 })
          .exec();
        if (clash) {
          throw new ConflictException({
            message: `${clash.name} already has this number on the guest list.`,
            guest: this.summarise(clash),
          });
        }
        guest.phone = parsed.e164;
      }
    }

    if (dto.group !== undefined) guest.group = dto.group;

    await guest.save();
    return this.summarise(guest);
  }

  /**
   * Shares one section — or the whole invitation — with the given guests.
   *
   * The same endpoint serves both "Share this section" and "Share complete
   * invitation": the only difference is whether `section` is set. That is what
   * keeps one invitation record behind every share.
   */
  async share(
    userId: string,
    bookingId: string,
    dto: ShareInvitationDto,
  ): Promise<{ mode: string; results: ShareOutcome[] }> {
    const { invitation, booking } = await this.publishedFor(userId, bookingId);

    const section = (dto.section ?? '').trim();
    if (section && !invitation.blocks.some((b) => b.key === section && !b.hidden)) {
      throw new BadRequestException('That section is not part of the published invitation');
    }

    const guests: InvitationGuestDocument[] = [];

    for (const id of dto.guestIds ?? []) {
      if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Unknown guest');
      const found = await this.guestModel.findOne({ _id: id, invitation: invitation._id }).exec();
      if (!found) throw new NotFoundException('Unknown guest');
      guests.push(found);
    }

    // New guests added inline from the dialog. An existing number quietly
    // resolves to the guest who already holds it rather than erroring — the
    // customer's intent here is "send to this person", not "create a record".
    for (const entry of dto.newGuests ?? []) {
      guests.push(
        await this.findOrCreateGuest(invitation, booking, entry.name, entry.phone, false),
      );
    }

    if (guests.length === 0) throw new BadRequestException('Choose at least one guest');

    // De-duplicate: selecting Rahul and also typing his number must send once.
    const unique = new Map(guests.map((g) => [g._id.toString(), g]));

    const results: ShareOutcome[] = [];
    for (const guest of unique.values()) {
      results.push(await this.sendTo(invitation, booking, guest, section));
    }
    return { mode: this.whatsapp.mode, results };
  }

  private async sendTo(
    invitation: InvitationDocument,
    booking: BookingDocument,
    guest: InvitationGuestDocument,
    section: string,
  ): Promise<ShareOutcome> {
    const block = invitation.blocks.find((b) => b.key === section);
    const sectionLabel = block ? block.heading || block.title : '';

    const hosts = [invitation.details.hostOne, invitation.details.hostTwo]
      .filter(Boolean)
      .join(` ${invitation.details.joiner || 'and'} `);
    const eventName = booking.title;

    const apiBase = this.config.get<string>('publicUrls.api') ?? '';
    const url = guestShareUrl(apiBase, guest.token, section);
    const appLink = this.config.get<string>('publicUrls.app') || undefined;

    const message = shareMessage({
      eventName,
      hosts,
      target: { section, sectionLabel },
      guestName: guest.name,
      url,
      appLink,
    });

    // Template placeholders, in the order an approved Cloud template would
    // declare them. Kept beside the free-text message because the two channels
    // genuinely accept different payloads.
    const result = await this.whatsapp.send(guest.phone, message, [
      guest.name,
      eventName,
      sectionLabel || 'invitation',
      url,
    ]);

    guest.shares.push({
      section,
      status: result.status,
      providerMessageId: result.providerMessageId ?? '',
      error: result.error ?? '',
      at: new Date(),
    } as never);
    await guest.save();

    return {
      guest: this.summarise(guest),
      status: result.status,
      handoffUrl: result.handoffUrl,
      url,
      error: result.error,
    };
  }

  /**
   * @param strict when true a duplicate number throws 409; when false it simply
   *   returns the guest who already has it. "Add guest" wants to be told;
   *   "share with these people" does not.
   */
  private async findOrCreateGuest(
    invitation: InvitationDocument,
    booking: BookingDocument,
    rawName: string,
    rawPhone: string,
    strict: boolean,
    group?: GuestGroup,
  ): Promise<InvitationGuestDocument> {
    const name = (rawName ?? '').trim();
    if (!name) throw new BadRequestException('Enter the guest’s name.');

    const parsed = parseGuestPhone(
      rawPhone ?? '',
      this.config.get<string>('otp.defaultDialCode') ?? '+91',
    );
    if (!parsed.ok) {
      throw new BadRequestException(PHONE_REJECTION_MESSAGE[parsed.reason ?? 'not_a_number']);
    }

    const existing = await this.guestModel
      .findOne({ invitation: invitation._id, phone: parsed.e164 })
      .exec();
    if (existing) {
      if (strict) {
        throw new ConflictException({
          message: `${existing.name} already has this number on the guest list.`,
          guest: this.summarise(existing),
        });
      }
      return existing;
    }

    try {
      return await this.guestModel.create({
        invitation: invitation._id,
        booking: booking._id,
        name,
        phone: parsed.e164,
        group: group ?? GuestGroup.OTHER,
        // 24 random bytes: this token *is* the guest's access to the
        // invitation, so it has to be unguessable, not merely unique.
        token: randomBytes(24).toString('base64url'),
        shares: [],
      });
    } catch (err) {
      // The unique index is the real guard; two simultaneous adds both find
      // nothing above and only one insert survives.
      if ((err as { code?: number })?.code === 11000) {
        const raced = await this.guestModel
          .findOne({ invitation: invitation._id, phone: parsed.e164 })
          .exec();
        if (raced) {
          if (strict) {
            throw new ConflictException({
              message: `${raced.name} already has this number on the guest list.`,
              guest: this.summarise(raced),
            });
          }
          return raced;
        }
      }
      throw err;
    }
  }

  private summarise(guest: InvitationGuestDocument): GuestSummary {
    const shares = guest.shares ?? [];
    return {
      id: guest._id.toString(),
      name: guest.name,
      phone: guest.phone,
      phoneDisplay: displayPhone(guest.phone),
      group: guest.group ?? GuestGroup.OTHER,
      // '' means the complete invitation; kept as a distinct entry so the UI
      // can say "whole invitation sent" as well as which sections went.
      sharedSections: [...new Set(shares.map((s) => s.section))],
      lastSharedAt: shares.length > 0 ? (shares[shares.length - 1]?.at ?? null) : null,
      viewed: Boolean(guest.firstViewedAt),
    };
  }

  // ----- guest side ----------------------------------------------------

  /**
   * The invitation behind a share token.
   *
   * Everything about this method is the security boundary for the whole
   * feature, because it is the one place that answers an unauthenticated
   * request. It resolves only approved invitations, and it returns a purpose-
   * built payload rather than the customer's view — the customer's view
   * carries change requests, ownership and hidden sections, none of which are
   * a guest's business.
   */
  /**
   * Token in, guest and invitation out — the one place a share link is
   * turned into an identity.
   *
   * Every public guest route goes through this and takes nothing else from
   * the caller, so there is a single rule to read and a single rule to get
   * right: the link says who you are, and an invitation that is not approved
   * does not exist.
   */
  /* Public so Shared Memories resolves a share link through this one rule
     rather than carrying a second copy of it. */
  async resolveGuest(token: string): Promise<{
    guest: InvitationGuestDocument;
    invitation: InvitationDocument;
  }> {
    if (!token || token.length < 16) {
      throw new NotFoundException('This invitation link is not valid');
    }
    const guest = await this.guestModel.findOne({ token }).exec();
    if (!guest) throw new NotFoundException('This invitation link is not valid');

    const invitation = await this.invitationModel.findById(guest.invitation).exec();
    if (!invitation || invitation.status !== InvitationStatus.APPROVED) {
      throw new NotFoundException('This invitation is not available');
    }
    return { guest, invitation };
  }

  async viewByToken(token: string): Promise<Record<string, unknown>> {
    const { guest, invitation } = await this.resolveGuest(token);
    const booking = await this.bookingModel.findById(guest.booking).exec();
    if (!booking) throw new NotFoundException('This invitation is not available');

    const now = new Date();
    if (!guest.firstViewedAt) guest.firstViewedAt = now;
    guest.lastViewedAt = now;
    await guest.save();

    return this.guestView(invitation, booking, guest);
  }

  /**
   * A guest saying they have read the day-before notice.
   *
   * The token is the credential and the only thing trusted: the guest, the
   * invitation and the event it concerns are all resolved from it server-side,
   * so no client-supplied id can reach another guest's record.
   *
   * The write is one conditional update rather than a read followed by a push.
   * A guest with the invitation open in two tabs can dismiss twice at the same
   * moment, and check-then-write would let both find nothing and both insert.
   */
  async dismissNotification(
    token: string,
    kind: NotificationKind = NotificationKind.ONE_DAY,
  ): Promise<{ dismissed: true }> {
    const { guest, invitation } = await this.resolveGuest(token);

    /*
     * Which notice, from the client; what it was about, from here.
     *
     * The kind is an enum the DTO has already checked, and it only ever picks
     * between two notices this guest could be shown. The event it concerns is
     * resolved server-side either way, so a guest cannot dismiss a notice on
     * behalf of an event they were never shown.
     */
    const about =
      kind === NotificationKind.LIVE_STARTED
        ? (liveViewFor(invitation, groupOf(guest))?.subEventId ?? '')
        : /* Recorded against the event the notice was about, so repointing the
             countdown later raises a new notice rather than reusing this. */
          (countdownTargetOf(invitation)?.subEventId ?? '');

    await this.guestModel
      .updateOne(
        {
          _id: guest._id,
          notifications: { $not: { $elemMatch: { kind, target: about } } },
        },
        { $push: { notifications: { kind, target: about, dismissedAt: new Date() } } },
      )
      .exec();

    /* Idempotent by design: dismissing something already dismissed is the
       state the caller asked for, not an error to report. */
    return { dismissed: true };
  }

  /** The name and event behind a token, for the link-preview meta tags. */
  async previewByToken(
    token: string,
  ): Promise<{ eventName: string; hosts: string; guestName: string; appUrl: string } | null> {
    const guest = await this.guestModel.findOne({ token }).exec();
    if (!guest) return null;
    const invitation = await this.invitationModel.findById(guest.invitation).exec();
    if (!invitation || invitation.status !== InvitationStatus.APPROVED) return null;
    const booking = await this.bookingModel.findById(guest.booking).exec();
    if (!booking) return null;

    return {
      eventName: booking.title,
      hosts: [invitation.details.hostOne, invitation.details.hostTwo]
        .filter(Boolean)
        .join(` ${invitation.details.joiner || 'and'} `),
      guestName: guest.name,
      appUrl: guestAppUrl(this.config.get<string>('publicUrls.web') ?? '', guest.token, ''),
    };
  }

  /**
   * Which of the two notices to raise, when both are due.
   *
   * The live one wins. They compete only in the last day before an event, and
   * of the two "it is happening right now, here is where to watch" is the one
   * a guest can still act on — the day-before card has nothing to add once the
   * thing it was warning about has begun.
   */
  private noticeFor(
    invitation: InvitationDocument,
    guest: InvitationGuestDocument,
    countdown: ReturnType<typeof countdownTargetOf>,
    live: ReturnType<typeof liveViewFor>,
  ): Record<string, unknown> {
    const liveNotice = liveNotificationFor(guest, live);
    if (liveNotice.show) return liveNotice as unknown as Record<string, unknown>;
    return notificationFor(invitation, guest, countdown, Date.now()) as unknown as Record<
      string,
      unknown
    >;
  }

  /**
   * A guest saying they still have the stream open, and being told how many
   * others do.
   *
   * A heartbeat rather than a subscription: there is no socket here, and a
   * count that is at most a minute and a half stale is what "248 watching"
   * means to a reader anyway. The event being watched is resolved from the
   * token exactly as everything else is — a guest cannot ask to be counted
   * against, or read the count of, an event they were not invited to.
   */
  async pingLive(token: string): Promise<{ watching: number; live: boolean }> {
    const { invitation, guest } = await this.resolveGuest(token);
    const live = liveViewFor(invitation, groupOf(guest));
    if (!live) {
      /* Nothing on: stop counting this guest rather than leaving them
         counted against an event that has since gone off air. */
      await this.guestModel.updateOne({ _id: guest._id }, { $set: { liveSeenTarget: '' } }).exec();
      return { watching: 0, live: false };
    }

    const now = new Date();
    await this.guestModel
      .updateOne({ _id: guest._id }, { $set: { liveSeenAt: now, liveSeenTarget: live.subEventId } })
      .exec();

    const watching = await this.guestModel
      .countDocuments({
        invitation: invitation._id,
        liveSeenTarget: live.subEventId,
        liveSeenAt: { $gte: new Date(now.getTime() - LIVE_WATCHING_WINDOW_MS) },
      })
      .exec();

    return { watching, live: true };
  }

  /**
   * What a guest is allowed to see.
   *
   * Built field by field rather than by deleting keys from the customer's
   * view: a new field added to that view later would then be exposed by
   * default, whereas here it stays private until someone deliberately adds it.
   */
  private guestView(
    invitation: InvitationDocument,
    booking: BookingDocument,
    guest: InvitationGuestDocument,
  ): Record<string, unknown> {
    const d = invitation.details;
    const countdown = countdownTargetOf(invitation);
    /* Decided from the guest's own group, here, once — the client is handed
       the stream it may watch or nothing at all. */
    const live = liveViewFor(invitation, groupOf(guest));
    return {
      guest: { name: guest.name },
      bookingTitle: booking.title,
      occasion: booking.occasion,
      /*
       * Named field by field, as this method's contract says — the details
       * document also carries working state (the hero media's storage key,
       * the RSVP deadline, the post-event note) that is the organizer's, not
       * the guest's. A spread would have handed all of it over the moment a
       * field was added.
       */
      details: {
        template: d.template,
        fontStyle: d.fontStyle,
        eyebrow: d.eyebrow,
        hostOne: d.hostOne,
        hostTwo: d.hostTwo,
        joiner: d.joiner,
        eventDate: d.eventDate,
        eventTime: d.eventTime,
        timezone: d.timezone,
        venueName: d.venueName,
        venueAddress: d.venueAddress,
        message: d.message,
        storyTitle: d.storyTitle,
        heroMediaType: d.heroMediaType,
        heroMediaUrl: d.heroMediaUrl,
        heroMediaDurationSec: d.heroMediaDurationSec,
        rsvpEnabled: d.rsvpEnabled,
        rsvpDeadline: d.rsvpDeadline,
        rsvpPlusOnes: d.rsvpPlusOnes,
      },
      /*
       * The story, in order and without its storage handles — a guest is given
       * the picture, not the means to address the file behind it.
       */
      storyCards: storyView(invitation),
      /*
       * What the countdown counts down to, as one absolute instant. The client
       * ticks locally from this — a server that sent a remaining figure every
       * second would be a request per second per guest, and would still be
       * wrong by the time it arrived.
       */
      countdown: countdown && {
        subEventId: countdown.subEventId,
        name: countdown.name,
        startsAt: countdown.startsAt,
        timezone: countdown.timezone,
        venueName: countdown.venueName,
        venueAddress: countdown.venueAddress,
        postEventMessage: d.postEventMessage,
      },
      /*
       * Whether to raise the day-before notice with this guest, decided here.
       * Only the answer and the words cross the wire — the organizer's
       * settings and the other guests' dismissals stay on this side.
       */
      notification: this.noticeFor(invitation, guest, countdown, live),
      /*
       * The stream, when one is on and this guest is invited to the event it
       * belongs to. Null the rest of the time, so the client has nothing to
       * render rather than a section it must remember to hide.
       */
      live,
      /*
       * Only the three switches a guest's own screen needs, never the
       * customer's window settings or their moderation queue.
       */
      memories: {
        enabled: Boolean(invitation.memories?.enabled),
        guestView: Boolean(invitation.memories?.guestView),
        guestUpload: Boolean(invitation.memories?.guestUpload),
      },
      /*
       * Hidden sections never reach a guest, so the filter cannot be forgotten
       * by a client that renders whatever it is handed — and what does reach
       * them carries no `owner` and no `approved`: whose section it is and who
       * signed it off is the builder's business, not the reader's.
       */
      blocks: invitation.blocks
        .filter((b) => !b.hidden)
        .map((b) => ({
          key: b.key,
          /* Derived where it was never stored, so a block written before types
             existed still tells the guest client which renderer it needs. */
          type:
            b.type && b.type !== BlockType.GENERIC
              ? b.type
              : (BLOCK_TYPE_BY_KEY[b.key] ?? BlockType.GENERIC),
          title: b.title,
          icon: b.icon,
          heading: b.heading,
          body: b.body,
        })),
      /*
       * Only the cards this guest is invited to, chosen on the server. The
       * old filter here showed every card marked visible to all; targeting
       * moved into one place that both this and the organizer's own view read.
       */
      subEvents: saveTheDateView(invitation, groupOf(guest)),
      templates: INVITATION_TEMPLATES,
      cardPalette: CARD_PALETTE,
      defaultSubEventMinutes: DEFAULT_SUB_EVENT_MINUTES,
    };
  }
}
