import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { createHash } from 'crypto';
import {
  InvitationMedia,
  InvitationMediaDocument,
  MediaVisibility,
  ModerationStatus,
  QualityStatus,
  RenditionStatus,
} from '../schemas/invitation-media.schema';
import { InvitationDocument } from '../schemas/invitation.schema';
import { InvitationGuestDocument } from '../schemas/invitation-guest.schema';
import { InvitationService } from '../invitation.service';
import { InvitationGuestService } from '../guest/invitation-guest.service';
import { UploadService } from '../../upload/upload.service';
import { UploadPurpose } from '../../upload/upload.constants';
import { guestSubEventsFor } from '../save-the-date.view';
import { groupOf } from '../save-the-date.view';
import { canDownload, canOverride, canReadMedia, canUpload, canViewGallery } from './access';
import { analyseImage, isNearDuplicate } from './image-checks';
import { isRenderableImage, makeRenditions } from './renditions';
import { clipRefusal, kindOf, subEventForUpload, uploadWindowOf } from './separation';
import type { UploadWindow } from './separation';
import {
  MEMORIES_MAX_PER_GUEST,
  MEMORY_CAPTION_MAX,
  MediaFlag,
  MediaKind,
  MediaState,
} from './memory.constants';
import { MemoriesSettingsDto } from '../dto/memories-settings.dto';
import { UploadMemoryDto } from '../dto/upload-memory.dto';
import { GalleryQueryDto } from '../dto/gallery-query.dto';

/** What a guest is told, in their words, never in ours. */
const COPY = {
  off: 'Shared photos are not switched on for this celebration.',
  uploadOff: 'The hosts are not accepting photos at the moment.',
  duplicate: 'This photo has already been shared.',
  unclear: 'This photo may not be clear enough.',
  dark: 'This photo may be too dark to see.',
  pending: 'Your memory was uploaded and is waiting for approval.',
  added: 'Your memory has been added.',
  full: `You have shared the maximum of ${MEMORIES_MAX_PER_GUEST} memories.`,
  noDownload: 'The hosts have not enabled downloads for this gallery.',
  gone: 'That memory is no longer available.',
};

/** The outcome of one upload, as the guest's screen reads it. */
export interface UploadOutcome {
  status: 'added' | 'pending' | 'duplicate' | 'flagged';
  message: string;
  media?: Record<string, unknown>;
}

const VIDEO_MIMES = ['video/mp4', 'video/webm', 'video/quicktime'];

@Injectable()
export class MemoriesService {
  private readonly logger = new Logger(MemoriesService.name);

  constructor(
    @InjectModel(InvitationMedia.name)
    private readonly mediaModel: Model<InvitationMediaDocument>,
    private readonly guests: InvitationGuestService,
    private readonly invitations: InvitationService,
    private readonly uploads: UploadService,
  ) {}

  /* ---------------------------------------------------------------- guests */

  /**
   * A guest adding a memory.
   *
   * The order matters and is the order the flow is written in: who they are,
   * whether the feature is open to them, whether the file is acceptable, what
   * it is, whether we already have it — and only then is a byte written to
   * storage. A duplicate never reaches the bucket, because the cheapest copy
   * of a file is the one never made.
   */
  async upload(
    token: string,
    file: Express.Multer.File | undefined,
    dto: UploadMemoryDto,
  ): Promise<UploadOutcome> {
    const { guest, invitation } = await this.guests.resolveGuest(token);
    const settings = invitation.memories;
    if (!settings?.enabled) throw new ForbiddenException(COPY.off);
    const window = this.windowOf(invitation);
    if (!canUpload(settings, window.open)) {
      throw new ForbiddenException(window.open ? COPY.uploadOff : window.reason);
    }

    /* Every rule from here on is shared with the host's path. */
    const visible = guestSubEventsFor(invitation.subEvents, groupOf(guest));
    return this.ingest(invitation, guest, visible, file, dto);
  }

  /**
   * One upload, from whoever is allowed to make it.
   *
   * Identity and permission are settled by the caller; everything here is the
   * part that must not differ between a guest and the host — which is why it
   * is one method and not two that have to be kept in step.
   *
   * `uploader` is the guest, or null for the customer. `allowedSubEvents` is
   * whichever celebrations that person may file a photograph under.
   */
  private async ingest(
    invitation: InvitationDocument,
    uploader: InvitationGuestDocument | null,
    allowedSubEvents: InvitationDocument['subEvents'],
    file: Express.Multer.File | undefined,
    dto: UploadMemoryDto,
    byOrganizer = false,
  ): Promise<UploadOutcome> {
    const settings = invitation.memories;
    if (!file?.buffer?.length) throw new BadRequestException('No file provided');

    if (uploader) {
      const mine = await this.mediaModel
        .countDocuments({ invitation: invitation._id, guest: uploader._id })
        .exec();
      if (mine >= MEMORIES_MAX_PER_GUEST) throw new BadRequestException(COPY.full);
    }

    const isClip = VIDEO_MIMES.includes(file.mimetype);
    const facts = { isClip, durationSec: dto.durationSec, reel: dto.reel };
    const refusal = clipRefusal(facts);
    if (refusal) throw new BadRequestException(refusal);

    const kind = kindOf(facts);

    /*
     * The uploader's own tag wins, and is checked against the celebrations
     * they may actually see — a tag naming a ceremony a guest was not invited
     * to would otherwise let them read its id back out of their own upload.
     */
    const taggedId =
      dto.subEventId &&
      allowedSubEvents.some(
        (e) => (e as { _id?: Types.ObjectId })._id?.toString() === dto.subEventId,
      )
        ? dto.subEventId
        : '';
    const subEvent = subEventForUpload(allowedSubEvents, taggedId, Date.now());

    /* Exact first: it is a hash of bytes we already hold, and it catches the
       same file sent twice, which is most of what a shared gallery collects. */
    const byteHash = createHash('sha256').update(file.buffer).digest('hex');
    const sameBytes = await this.mediaModel
      .findOne({ invitation: invitation._id, byteHash })
      .exec();
    if (sameBytes) return { status: 'duplicate', message: COPY.duplicate };

    let perceptualHash = '';
    const flags: MediaFlag[] = [];
    let qualityStatus = QualityStatus.NOT_CHECKED;

    if (!isClip) {
      /* Photographs only. A clip's pixels are behind a decoder this service
         does not have, and guessing from its poster frame would be a check
         that reports on something the guest never sees. */
      const analysis = await analyseImage(file.buffer);
      perceptualHash = analysis.hash;

      const candidates = await this.mediaModel
        .find({ invitation: invitation._id, kind: MediaKind.PHOTO })
        .select('perceptualHash')
        .lean()
        .exec();
      if (candidates.some((c) => isNearDuplicate(c.perceptualHash ?? '', perceptualHash))) {
        return { status: 'duplicate', message: COPY.duplicate };
      }

      if (analysis.blurry) flags.push(MediaFlag.BLURRY);
      if (analysis.dark) flags.push(MediaFlag.DARK);
      qualityStatus = flags.length > 0 ? QualityStatus.FLAGGED : QualityStatus.OK;
    }

    const stored = await this.uploads.upload(
      file,
      isClip ? UploadPurpose.MEMORY_VIDEO : UploadPurpose.MEMORY_PHOTO,
    );

    /* The original is safe from here on. Anything that goes wrong below costs
       the gallery some bytes, never the photograph. */
    const renditions = isRenderableImage(file.mimetype)
      ? await this.renditionsFor(file.buffer, stored.key)
      : {
          status: RenditionStatus.NONE,
          thumbnailKey: '',
          thumbnailUrl: '',
          displayKey: '',
          displayUrl: '',
        };

    /*
     * Three independent reasons a memory may not be in the gallery, and they
     * are kept apart because they end differently: moderation waits for a
     * person, a quality flag waits for the uploader, and neither is a deletion.
     */
    const awaiting = Boolean(settings?.moderation);
    const flagged = flags.length > 0;

    const media = await this.mediaModel.create({
      invitation: invitation._id,
      booking: invitation.booking,
      subEvent,
      ...(uploader ? { guest: uploader._id } : byOrganizer ? { organizer: true } : { host: true }),
      kind,
      storageKey: stored.key,
      url: stored.url,
      thumbnailKey: renditions.thumbnailKey,
      thumbnailUrl: renditions.thumbnailUrl,
      displayKey: renditions.displayKey,
      displayUrl: renditions.displayUrl,
      renditionStatus: renditions.status,
      caption: (dto.caption ?? '').trim().slice(0, MEMORY_CAPTION_MAX),
      status: awaiting ? MediaState.PENDING : MediaState.PUBLISHED,
      moderationStatus: awaiting ? ModerationStatus.AWAITING : ModerationStatus.NOT_REQUIRED,
      visibility: flagged ? MediaVisibility.UPLOADER : MediaVisibility.GALLERY,
      byteHash,
      perceptualHash,
      qualityStatus,
      qualityFlags: flags,
      durationSec: isClip ? Math.max(0, Math.round(dto.durationSec ?? 0)) : 0,
    });

    if (flagged) {
      return {
        status: 'flagged',
        message: flags.includes(MediaFlag.BLURRY) ? COPY.unclear : COPY.dark,
        media: this.view(media, uploader),
      };
    }
    return {
      status: awaiting ? 'pending' : 'added',
      message: awaiting ? COPY.pending : COPY.added,
      media: this.view(media, uploader),
    };
  }

  /**
   * The customer adding a memory from their own phone.
   *
   * The same pipeline as a guest's, reached through the customer's own login
   * rather than a share token — they are the one person at the celebration
   * with an account, and they are not on their own guest list. Every rule
   * below the identity check is shared with `upload`: the same duplicate
   * checks, the same quality checks, the same renditions, the same moderation.
   * A host's memory is not exempt from moderation they themselves switched on.
   */
  async uploadAsHost(
    userId: string,
    bookingId: string,
    file: Express.Multer.File | undefined,
    dto: UploadMemoryDto,
  ): Promise<UploadOutcome> {
    const booking = await this.invitations.customerBooking(userId, bookingId);
    const invitation = await this.invitations.sharedInvitation(booking);

    const settings = invitation.memories;
    if (!settings?.enabled) throw new ForbiddenException(COPY.off);
    /*
     * The upload window applies to the host too. It is their own setting, and
     * a gallery that closes for everyone except the person who closed it is a
     * setting that does not mean anything.
     */
    const window = this.windowOf(invitation);
    if (!window.open) throw new ForbiddenException(window.reason);

    /* Every sub-event, because it is their celebration — no group filter. */
    return this.ingest(invitation, null, invitation.subEvents, file, dto);
  }

  /**
   * The uploader saying they meant it.
   *
   * Only ever their own item, and only a quality flag — a guest cannot
   * overrule moderation, which is somebody else's decision about their
   * own celebration.
   */
  async override(token: string, mediaId: string): Promise<Record<string, unknown>> {
    const { guest, invitation } = await this.guests.resolveGuest(token);
    const media = await this.inInvitation(invitation, mediaId);
    if (!canOverride(this.factsOf(media), guest._id.toString())) {
      throw new NotFoundException(COPY.gone);
    }
    if (media.qualityStatus !== QualityStatus.FLAGGED) return this.view(media, guest);

    media.visibility = MediaVisibility.GALLERY;
    media.qualityFlags = [];
    media.qualityStatus = QualityStatus.OK;
    await media.save();
    return this.view(media, guest);
  }

  /**
   * The gallery, as one guest may read it.
   *
   * Every clause of the filter is the server's: the invitation comes from the
   * token, the published state from the record, and the celebrations from what
   * this guest was invited to. A client sends a tab and a page and nothing
   * that decides what it is allowed to see.
   */
  async gallery(token: string, query: GalleryQueryDto): Promise<Record<string, unknown>> {
    const { guest, invitation } = await this.guests.resolveGuest(token);
    const settings = invitation.memories;
    if (!canViewGallery(settings)) throw new ForbiddenException(COPY.off);

    const allowed = this.allowedSubEvents(invitation, guest);
    const filter = this.publishedFilter(invitation, allowed);

    if (query.kind && query.kind !== 'all') filter.kind = query.kind;
    if (query.subEvent && query.subEvent !== 'all') {
      /* Narrowing to a celebration they may not see narrows to nothing rather
         than widening past the rule above. */
      if (!allowed.includes(query.subEvent)) filter.subEvent = '\u0000never';
      else filter.subEvent = query.subEvent;
    }

    const limit = Math.min(Math.max(query.limit ?? 24, 1), 60);
    /* Keyset rather than skip: a gallery people are adding to while they read
       it shifts under an offset, and the same photograph appears on two pages. */
    if (query.before) {
      const at = new Date(query.before);
      if (!Number.isNaN(at.getTime())) filter.createdAt = { $lt: at };
    }

    const rows = await this.mediaModel
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(limit + 1)
      .exec();

    const page = rows.slice(0, limit);
    const next = rows.length > limit ? page[page.length - 1]?.createdAt?.toISOString() : '';

    const counts = await this.counts(invitation, allowed);

    return {
      items: page.map((m) => this.view(m, guest)),
      nextCursor: next ?? '',
      counts,
      subEvents: guestSubEventsFor(invitation.subEvents, groupOf(guest)).map((e) => ({
        id: (e as { _id?: Types.ObjectId })._id?.toString() ?? '',
        name: e.name,
      })),
      canUpload: Boolean(settings.guestUpload) && this.windowOf(invitation).open,
      canDownload: Boolean(settings.guestDownload),
      window: this.windowOf(invitation),
    };
  }

  /**
   * One item, with the two beside it.
   *
   * Resolved here rather than by the client holding the list, so the arrows
   * still work on a gallery that has changed since the page loaded — and so
   * they can never step onto something this guest may not see.
   */
  async item(token: string, mediaId: string): Promise<Record<string, unknown>> {
    const { guest, invitation } = await this.guests.resolveGuest(token);
    const settings = invitation.memories;
    if (!canViewGallery(settings)) throw new ForbiddenException(COPY.off);

    const media = await this.readable(invitation, guest, mediaId);
    const allowed = this.allowedSubEvents(invitation, guest);
    const base = this.publishedFilter(invitation, allowed);

    const [newer, older] = await Promise.all([
      this.mediaModel
        .findOne({ ...base, createdAt: { $gt: media.createdAt } })
        .sort({ createdAt: 1 })
        .select('_id')
        .lean()
        .exec(),
      this.mediaModel
        .findOne({ ...base, createdAt: { $lt: media.createdAt } })
        .sort({ createdAt: -1 })
        .select('_id')
        .lean()
        .exec(),
    ]);

    return {
      ...this.view(media, guest),
      previousId: newer?._id?.toString() ?? '',
      nextId: older?._id?.toString() ?? '',
      canDownload: Boolean(settings.guestDownload),
    };
  }

  /** One like per guest, enforced by the write rather than by a check. */
  async like(token: string, mediaId: string, on: boolean): Promise<Record<string, unknown>> {
    const { guest, invitation } = await this.guests.resolveGuest(token);
    if (!canViewGallery(invitation.memories)) throw new ForbiddenException(COPY.off);

    const media = await this.readable(invitation, guest, mediaId);
    await this.mediaModel
      .updateOne(
        { _id: media._id },
        on ? { $addToSet: { likes: guest._id } } : { $pull: { likes: guest._id } },
      )
      .exec();

    const fresh = await this.mediaModel.findById(media._id).exec();
    return fresh ? this.view(fresh, guest) : this.view(media, guest);
  }

  /**
   * A download, if the customer allowed one.
   *
   * The permission is checked here and the url only exists in the answer when
   * it passes — a client that hides its own button is a client, and the file
   * is one guessed request away from anyone who does not.
   */
  async download(token: string, mediaId: string): Promise<{ url: string; fileName: string }> {
    const { guest, invitation } = await this.guests.resolveGuest(token);
    if (!canDownload(invitation.memories)) throw new ForbiddenException(COPY.noDownload);

    const media = await this.readable(invitation, guest, mediaId);
    return { url: media.url, fileName: media.storageKey.split('/').pop() ?? 'memory' };
  }

  /* ------------------------------------------------------------- customers */

  /** The settings, as their owner sees them. */
  async settings(userId: string, bookingId: string): Promise<Record<string, unknown>> {
    const booking = await this.invitations.customerBooking(userId, bookingId);
    const invitation = await this.invitations.sharedInvitation(booking);
    return this.settingsView(invitation);
  }

  /**
   * The customer changing them.
   *
   * Only ever the customer: the organizer assembles the invitation, but the
   * gallery is the customer's guests photographing the customer's wedding, so
   * whether it exists and who may download from it is not the organizer's to
   * decide. There is deliberately no organizer route to this.
   */
  async saveSettings(
    userId: string,
    bookingId: string,
    dto: MemoriesSettingsDto,
  ): Promise<Record<string, unknown>> {
    const booking = await this.invitations.customerBooking(userId, bookingId);
    const invitation = await this.invitations.sharedInvitation(booking);

    const next = { ...(invitation.memories ?? {}) };
    if (dto.enabled !== undefined) next.enabled = dto.enabled;
    if (dto.guestUpload !== undefined) next.guestUpload = dto.guestUpload;
    if (dto.guestView !== undefined) next.guestView = dto.guestView;
    if (dto.guestDownload !== undefined) next.guestDownload = dto.guestDownload;
    if (dto.moderation !== undefined) next.moderation = dto.moderation;
    if (dto.uploadFrom !== undefined) next.uploadFrom = dto.uploadFrom;
    if (dto.uploadWindowDays !== undefined) next.uploadWindowDays = dto.uploadWindowDays;

    invitation.memories = next as InvitationDocument['memories'];
    invitation.markModified('memories');
    await invitation.save();
    return this.settingsView(invitation);
  }

  /* ------------------------------------------------------------ organizers */

  /**
   * The organizer adding a memory to a celebration they are running.
   *
   * They are at the wedding with a camera, and their photographs belong in the
   * same gallery as everyone else's. What they get is deliberately narrow: add
   * one, and see what is there. Whether the gallery exists at all, who may
   * download from it, what is approved and what is deleted stay the customer's
   * — those are decisions about the customer's own photographs, and a vendor
   * is not the person to make them.
   *
   * Their upload is not privileged either: the customer's moderation and the
   * customer's upload window apply to it exactly as they apply to a guest's.
   */
  async uploadAsOrganizer(
    userId: string,
    bookingId: string,
    file: Express.Multer.File | undefined,
    dto: UploadMemoryDto,
  ): Promise<UploadOutcome> {
    const invitation = await this.organizerInvitation(userId, bookingId);

    const settings = invitation.memories;
    if (!settings?.enabled) throw new ForbiddenException(COPY.off);
    const window = this.windowOf(invitation);
    if (!window.open) throw new ForbiddenException(window.reason);

    return this.ingest(invitation, null, invitation.subEvents, file, dto, true);
  }

  /** The gallery, as the organizer running the celebration reads it. */
  async organizerGallery(
    userId: string,
    bookingId: string,
    query: GalleryQueryDto,
  ): Promise<Record<string, unknown>> {
    const invitation = await this.organizerInvitation(userId, bookingId);
    if (!invitation.memories?.enabled) throw new ForbiddenException(COPY.off);
    return this.page(invitation, query);
  }

  /**
   * The invitation behind a booking this organizer runs.
   *
   * The ownership question is the invitation module's own — asked here rather
   * than restated, so an organizer cannot reach another organizer's booking
   * by any route, including this one.
   */
  private async organizerInvitation(
    userId: string,
    bookingId: string,
  ): Promise<InvitationDocument> {
    const booking = await this.invitations.organizerBooking(userId, bookingId);
    const invitation = await this.mediaModel.db
      .model<InvitationDocument>('Invitation')
      .findOne({ booking: booking._id })
      .exec();
    if (!invitation) throw new NotFoundException(COPY.gone);
    return invitation;
  }

  /* ------------------------------------------------------------- customers */

  /**
   * The customer's own gallery: everything on their invitation.
   *
   * The same shape the guest gallery answers with, and deliberately a separate
   * method rather than a flag on that one — a guest's page is narrowed by what
   * they were invited to and what has been approved, and this one is not
   * narrowed at all. Fusing them would put an "are you the owner" branch
   * inside the filter that keeps guests apart.
   */
  async manage(
    userId: string,
    bookingId: string,
    query: GalleryQueryDto,
  ): Promise<Record<string, unknown>> {
    const booking = await this.invitations.customerBooking(userId, bookingId);
    const invitation = await this.invitations.sharedInvitation(booking);
    return this.page(invitation, query);
  }

  /**
   * One page of an invitation's whole gallery.
   *
   * Shared by the two people who may see all of it. Deliberately not the guest
   * query: that one is narrowed by what the guest was invited to and what has
   * been approved, and fusing them would put an "are you staff" branch inside
   * the filter that keeps guests apart.
   */
  private async page(
    invitation: InvitationDocument,
    query: GalleryQueryDto,
  ): Promise<Record<string, unknown>> {
    const filter: Record<string, unknown> = { invitation: invitation._id };
    if (query.kind && query.kind !== 'all') filter.kind = query.kind;
    if (query.subEvent && query.subEvent !== 'all') filter.subEvent = query.subEvent;
    if (query.before) {
      const at = new Date(query.before);
      if (!Number.isNaN(at.getTime())) filter.createdAt = { $lt: at };
    }

    const limit = Math.min(Math.max(query.limit ?? 24, 1), 60);
    const rows = await this.mediaModel
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(limit + 1)
      .populate('guest', 'name')
      .exec();

    const page = rows.slice(0, limit);
    const next = rows.length > limit ? page[page.length - 1]?.createdAt?.toISOString() : '';

    const [counts, awaiting] = await Promise.all([
      this.mediaModel.aggregate<{ _id: MediaKind; n: number }>([
        { $match: { invitation: invitation._id } },
        { $group: { _id: '$kind', n: { $sum: 1 } } },
      ]),
      this.mediaModel
        .countDocuments({
          invitation: invitation._id,
          moderationStatus: ModerationStatus.AWAITING,
        })
        .exec(),
    ]);

    const tally: Record<string, number> = { all: 0, photo: 0, video: 0, reel: 0 };
    for (const row of counts) {
      tally[row._id] = row.n;
      tally.all += row.n;
    }

    return {
      items: page.map((m) => this.manageView(m)),
      nextCursor: next ?? '',
      counts: tally,
      awaiting,
      subEvents: invitation.subEvents.map((e) => ({
        id: (e as { _id?: Types.ObjectId })._id?.toString() ?? '',
        name: e.name,
      })),
    };
  }

  /**
   * Taking one out of the gallery without destroying it.
   *
   * Between approving and deleting: a photograph the customer would rather
   * guests did not see, but which is still somebody's photograph of their
   * wedding. Reversible, which deletion is not.
   */
  async setHidden(
    userId: string,
    bookingId: string,
    mediaId: string,
    hidden: boolean,
  ): Promise<Record<string, unknown>> {
    const booking = await this.invitations.customerBooking(userId, bookingId);
    const invitation = await this.invitations.sharedInvitation(booking);
    const media = await this.inInvitation(invitation, mediaId);

    media.status = hidden ? MediaState.HIDDEN : MediaState.PUBLISHED;
    await media.save();
    await media.populate('guest', 'name');
    return this.manageView(media);
  }

  /** What is waiting for the customer, when moderation is on. */
  async awaiting(userId: string, bookingId: string): Promise<Array<Record<string, unknown>>> {
    const booking = await this.invitations.customerBooking(userId, bookingId);
    const invitation = await this.invitations.sharedInvitation(booking);
    const rows = await this.mediaModel
      .find({ invitation: invitation._id, moderationStatus: ModerationStatus.AWAITING })
      .sort({ createdAt: -1 })
      .limit(200)
      .populate('guest', 'name')
      .exec();
    return rows.map((m) => this.manageView(m));
  }

  /** The customer approving or rejecting one. */
  async moderate(
    userId: string,
    bookingId: string,
    mediaId: string,
    approve: boolean,
  ): Promise<Record<string, unknown>> {
    const booking = await this.invitations.customerBooking(userId, bookingId);
    const invitation = await this.invitations.sharedInvitation(booking);
    const media = await this.inInvitation(invitation, mediaId);

    media.moderationStatus = approve ? ModerationStatus.APPROVED : ModerationStatus.REJECTED;
    media.status = approve ? MediaState.PUBLISHED : MediaState.HIDDEN;
    /*
     * Approving also clears a quality hold. The checks are a suggestion to
     * whoever is looking; once a person has looked and said yes, keeping the
     * photograph out of the gallery would be the machine overruling them.
     */
    if (approve) {
      media.visibility = MediaVisibility.GALLERY;
    } else if (!media.qualityFlags.includes(MediaFlag.REJECTED)) {
      media.qualityFlags = [...media.qualityFlags, MediaFlag.REJECTED];
    }
    await media.save();
    await media.populate('guest', 'name');
    return this.manageView(media);
  }

  /** The customer removing one for good, file and all. */
  async remove(userId: string, bookingId: string, mediaId: string): Promise<{ removed: true }> {
    const booking = await this.invitations.customerBooking(userId, bookingId);
    const invitation = await this.invitations.sharedInvitation(booking);
    const media = await this.inInvitation(invitation, mediaId);

    /* Storage first: a record without a file is a broken tile, a file without
       a record is only an orphan nobody can reach. All three copies, because
       removing the original and leaving its thumbnail behind would leave the
       photograph readable to anyone holding the smaller url. */
    await Promise.all(
      [media.storageKey, media.thumbnailKey, media.displayKey]
        .filter(Boolean)
        .map((key) => this.uploads.remove(key).catch(() => undefined)),
    );
    await this.mediaModel.deleteOne({ _id: media._id }).exec();
    return { removed: true };
  }

  /* --------------------------------------------------------------- private */

  /**
   * The two smaller copies, stored beside the original.
   *
   * Never fatal. By the time this runs the original is in storage and the
   * guest's photograph is safe, so a decoder that cannot read some unusual
   * file costs the gallery a thumbnail and nothing else — the record is marked
   * `failed`, the view falls back to the original, and the line in the log
   * says which media it was so it can be regenerated later.
   *
   * Deleting the original on a rendition failure would be the one genuinely
   * destructive response available here, which is why it is not one.
   */
  private async renditionsFor(
    buffer: Buffer,
    originalKey: string,
  ): Promise<{
    status: RenditionStatus;
    thumbnailKey: string;
    thumbnailUrl: string;
    displayKey: string;
    displayUrl: string;
  }> {
    const none = {
      status: RenditionStatus.FAILED,
      thumbnailKey: '',
      thumbnailUrl: '',
      displayKey: '',
      displayUrl: '',
    };
    try {
      const { thumbnail, display } = await makeRenditions(buffer);
      const [thumbStored, displayStored] = await Promise.all([
        this.uploads.putVariant(
          originalKey,
          'thumb',
          thumbnail.buffer,
          thumbnail.extension,
          thumbnail.contentType,
        ),
        this.uploads.putVariant(
          originalKey,
          'display',
          display.buffer,
          display.extension,
          display.contentType,
        ),
      ]);
      return {
        status: RenditionStatus.READY,
        thumbnailKey: thumbStored.key,
        thumbnailUrl: thumbStored.url,
        displayKey: displayStored.key,
        displayUrl: displayStored.url,
      };
    } catch (error) {
      this.logger.error(
        `Rendition failed for ${originalKey}: ${(error as Error)?.message ?? error}`,
      );
      return none;
    }
  }

  private windowOf(invitation: InvitationDocument): UploadWindow {
    const s = invitation.memories;
    const d = invitation.details;
    return uploadWindowOf(
      invitation.subEvents,
      d.eventDate,
      d.eventTime,
      d.timezone,
      s?.uploadFrom ?? '',
      s?.uploadWindowDays ?? 7,
      Date.now(),
    );
  }

  /** The sub-event ids this guest may see, plus '' for the celebration itself. */
  private allowedSubEvents(
    invitation: InvitationDocument,
    guest: InvitationGuestDocument,
  ): string[] {
    const ids = guestSubEventsFor(invitation.subEvents, groupOf(guest)).map(
      (e) => (e as { _id?: Types.ObjectId })._id?.toString() ?? '',
    );
    return ['', ...ids];
  }

  /** Everything a guest may see: published, in the gallery, past moderation. */
  private publishedFilter(
    invitation: InvitationDocument,
    allowed: string[],
  ): Record<string, unknown> {
    return {
      invitation: invitation._id,
      status: MediaState.PUBLISHED,
      visibility: MediaVisibility.GALLERY,
      moderationStatus: {
        $in: [ModerationStatus.NOT_REQUIRED, ModerationStatus.APPROVED],
      } /* the query form of `isPastModeration` */,
      subEvent: { $in: allowed },
    };
  }

  private async counts(
    invitation: InvitationDocument,
    allowed: string[],
  ): Promise<Record<string, number>> {
    const rows = await this.mediaModel.aggregate<{ _id: MediaKind; n: number }>([
      { $match: this.publishedFilter(invitation, allowed) },
      { $group: { _id: '$kind', n: { $sum: 1 } } },
    ]);
    const counts: Record<string, number> = { all: 0, photo: 0, video: 0, reel: 0 };
    for (const row of rows) {
      counts[row._id] = row.n;
      counts.all += row.n;
    }
    return counts;
  }

  /** One item this guest may read: in the gallery, or their own. */
  private async readable(
    invitation: InvitationDocument,
    guest: InvitationGuestDocument,
    mediaId: string,
  ): Promise<InvitationMediaDocument> {
    const media = await this.inInvitation(invitation, mediaId);
    const allowed = this.allowedSubEvents(invitation, guest);
    /* Same 404 either way: a guest learning that an id exists but is not
       theirs has learned something about somebody else's celebration. */
    if (!canReadMedia(this.factsOf(media), guest._id.toString(), allowed)) {
      throw new NotFoundException(COPY.gone);
    }
    return media;
  }

  /** One row, reduced to what the access rules actually look at. */
  private factsOf(media: InvitationMediaDocument) {
    return {
      ownerGuestId: media.guest?.toString() ?? '',
      subEvent: media.subEvent,
      status: media.status,
      visibility: media.visibility,
      moderationStatus: media.moderationStatus,
    };
  }

  /**
   * An id, resolved inside one invitation.
   *
   * The scope is the point: a media id from another wedding is a 404 here, so
   * no caller can reach across events by passing one in.
   */
  private async inInvitation(
    invitation: InvitationDocument,
    mediaId: string,
  ): Promise<InvitationMediaDocument> {
    if (!Types.ObjectId.isValid(mediaId)) throw new NotFoundException(COPY.gone);
    const media = await this.mediaModel
      .findOne({ _id: new Types.ObjectId(mediaId), invitation: invitation._id })
      .exec();
    if (!media) throw new NotFoundException(COPY.gone);
    return media;
  }

  /** One item, as anyone outside the server reads it. */
  private view(
    media: InvitationMediaDocument,
    guest: InvitationGuestDocument | null,
  ): Record<string, unknown> {
    return {
      id: media._id.toString(),
      kind: media.kind,
      subEvent: media.subEvent,
      /*
       * Three sizes, each where it belongs, and each falling back to the one
       * above it — so a record from before renditions existed, or one whose
       * renditions failed, still renders rather than showing a gap.
       *
       * `url` is the original and is here for the download flow; the grid
       * reads `thumbnailUrl` and the viewer reads `displayUrl`. The storage
       * keys themselves never leave.
       */
      url: media.url,
      thumbnailUrl: media.thumbnailUrl || media.displayUrl || media.url,
      displayUrl: media.displayUrl || media.url,
      caption: media.caption,
      durationSec: media.durationSec,
      likes: media.likes.length,
      likedByMe: guest ? media.likes.some((id) => id.toString() === guest._id.toString()) : false,
      mine: guest ? media.guest?.toString() === guest._id.toString() : false,
      /* Only ever on the uploader's own copy: it is about their photograph. */
      flags: guest && media.guest?.toString() === guest._id.toString() ? media.qualityFlags : [],
      state:
        media.moderationStatus === ModerationStatus.AWAITING
          ? 'pending'
          : media.visibility === MediaVisibility.UPLOADER
            ? 'flagged'
            : media.status,
      createdAt: media.createdAt?.toISOString() ?? '',
    };
  }

  /**
   * One row, as its owner reads it.
   *
   * Carries what the guest's view deliberately does not: who uploaded it, the
   * moderation state, and the quality flags — the customer is deciding about
   * this photograph and needs the reasons. Still no storage keys: those are
   * the server's handles and have no meaning to any screen.
   */
  private manageView(media: InvitationMediaDocument): Record<string, unknown> {
    const uploader = media.guest as unknown as { name?: string } | null;
    /* The host is named as the host rather than left blank: "shared by —" on
       your own photograph reads as a bug. */
    const by = media.host ? 'You' : media.organizer ? 'Your organizer' : (uploader?.name ?? '');
    return {
      id: media._id.toString(),
      kind: media.kind,
      subEvent: media.subEvent,
      url: media.url,
      thumbnailUrl: media.thumbnailUrl || media.displayUrl || media.url,
      displayUrl: media.displayUrl || media.url,
      caption: media.caption,
      durationSec: media.durationSec,
      likes: media.likes.length,
      /* Populated when the guest record is still there; a guest removed from
         the list leaves their photographs behind without a name on them. */
      uploader: by,
      status: media.status,
      moderationStatus: media.moderationStatus,
      visibility: media.visibility,
      /* The plain words, not the measurements. */
      flags: media.qualityFlags,
      renditionStatus: media.renditionStatus,
      createdAt: media.createdAt?.toISOString() ?? '',
    };
  }

  private settingsView(invitation: InvitationDocument): Record<string, unknown> {
    const s = invitation.memories;
    return {
      enabled: Boolean(s?.enabled),
      guestUpload: Boolean(s?.guestUpload),
      guestView: Boolean(s?.guestView),
      guestDownload: Boolean(s?.guestDownload),
      moderation: Boolean(s?.moderation),
      uploadFrom: s?.uploadFrom ?? '',
      uploadWindowDays: s?.uploadWindowDays ?? 7,
      window: this.windowOf(invitation),
    };
  }
}
