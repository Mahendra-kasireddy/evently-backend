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
  InvitationGuest,
  InvitationGuestDocument,
  ShareStatus,
} from '../schemas/invitation-guest.schema';
import { Booking, BookingDocument } from '../../booking/schemas/booking.schema';
import {
  CARD_PALETTE,
  DEFAULT_SUB_EVENT_MINUTES,
  INVITATION_TEMPLATES,
} from '../invitation-defaults';
import { AddGuestDto } from '../dto/add-guest.dto';
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
    const guest = await this.findOrCreateGuest(invitation, booking, dto.name, dto.phone, true);
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
  async viewByToken(token: string): Promise<Record<string, unknown>> {
    if (!token || token.length < 16)
      throw new NotFoundException('This invitation link is not valid');

    const guest = await this.guestModel.findOne({ token }).exec();
    if (!guest) throw new NotFoundException('This invitation link is not valid');

    const invitation = await this.invitationModel.findById(guest.invitation).exec();
    if (!invitation || invitation.status !== InvitationStatus.APPROVED) {
      throw new NotFoundException('This invitation is not available');
    }
    const booking = await this.bookingModel.findById(guest.booking).exec();
    if (!booking) throw new NotFoundException('This invitation is not available');

    const now = new Date();
    if (!guest.firstViewedAt) guest.firstViewedAt = now;
    guest.lastViewedAt = now;
    await guest.save();

    return this.guestView(invitation, booking, guest);
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
    return {
      guest: { name: guest.name },
      bookingTitle: booking.title,
      occasion: booking.occasion,
      details: invitation.details,
      // Hidden sections never reach a guest, so the filter cannot be forgotten
      // by a client that renders whatever it is handed.
      blocks: invitation.blocks.filter((b) => !b.hidden),
      subEvents: invitation.subEvents
        .filter((e) => e.visibility === 'all' && e.name.trim() !== '')
        .map((e) => ({
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
        })),
      templates: INVITATION_TEMPLATES,
      cardPalette: CARD_PALETTE,
      defaultSubEventMinutes: DEFAULT_SUB_EVENT_MINUTES,
    };
  }
}
