import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { UploadService } from '../upload/upload.service';
import { UploadPurpose } from '../upload/upload.constants';
import { canAttendeeUpload, canAttendeeViewMemories } from './access';
import { PUBLIC_STATUSES } from './public-event.constants';
import { CustomerPublicEventService } from './customer-public-event.service';
import { PublicEventService } from './public-event.service';
import { PublicEvent, PublicEventDocument } from './schemas/public-event.schema';
import {
  EventMemory,
  EventMemoryDocument,
  EventMemoryKind,
  EventMemoryStatus,
} from './schemas/event-memory.schema';

const PAGE_LIMIT = 60;

/**
 * A public event's shared memories: attendees' photos and clips.
 *
 * Who may look and who may add is decided by the rules the event detail
 * already reports (`canAttendeeViewMemories`, `canAttendeeUpload`), checked
 * again here on every call — the app hiding a button is not the gate, this is.
 * Files go through the one shared UploadService, under the memory purposes the
 * invitation gallery already validates against.
 */
@Injectable()
export class EventMemoryService {
  constructor(
    @InjectModel(EventMemory.name)
    private readonly memoryModel: Model<EventMemoryDocument>,
    @InjectModel(PublicEvent.name)
    private readonly eventModel: Model<PublicEventDocument>,
    private readonly customers: CustomerPublicEventService,
    private readonly events: PublicEventService,
    private readonly uploads: UploadService,
  ) {}

  /* ------------------------------------------------------------ attendees */

  async list(eventId: string, userId: string, kind?: EventMemoryKind) {
    const event = await this.publicEvent(eventId);
    const standing = await this.customers.standingFor(event._id, userId);
    if (!canAttendeeViewMemories(event, standing)) {
      throw new ForbiddenException('The gallery is open to this event’s ticket holders');
    }

    const filter: FilterQuery<EventMemoryDocument> = {
      event: event._id,
      $or: [
        { status: EventMemoryStatus.VISIBLE },
        // Your own uploads still waiting for the organizer, so they do not
        // look lost.
        { status: EventMemoryStatus.PENDING, uploader: new Types.ObjectId(userId) },
      ],
      ...(kind ? { kind } : {}),
    };
    const rows = await this.memoryModel
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(PAGE_LIMIT)
      .exec();

    return {
      items: rows.map((m) => this.view(m, userId)),
      canUpload: canAttendeeUpload(event, standing),
    };
  }

  async upload(
    eventId: string,
    userId: string,
    file: Express.Multer.File | undefined,
    caption = '',
  ) {
    const event = await this.publicEvent(eventId);
    const standing = await this.customers.standingFor(event._id, userId);
    if (!canAttendeeUpload(event, standing)) {
      throw new ForbiddenException('Uploads are not open to you for this event');
    }
    if (!file) throw new BadRequestException('No file provided');

    const isVideo = (file.mimetype ?? '').startsWith('video/');
    const stored = await this.uploads.upload(
      file,
      isVideo ? UploadPurpose.MEMORY_VIDEO : UploadPurpose.MEMORY_PHOTO,
    );

    const memory = await this.memoryModel.create({
      event: event._id,
      uploader: new Types.ObjectId(userId),
      kind: isVideo ? EventMemoryKind.VIDEO : EventMemoryKind.PHOTO,
      url: stored.url,
      storageKey: stored.key,
      caption: caption.trim().slice(0, 280),
      status: event.memories?.moderation ? EventMemoryStatus.PENDING : EventMemoryStatus.VISIBLE,
    });
    return this.view(memory, userId);
  }

  /* ------------------------------------------------------------ organizer */

  async listForOrganizer(userId: string, eventId: string, status?: EventMemoryStatus) {
    const event = await this.events.ownedEvent(userId, eventId);
    const rows = await this.memoryModel
      .find({ event: event._id, ...(status ? { status } : {}) })
      .sort({ createdAt: -1 })
      .limit(200)
      .exec();
    return { items: rows.map((m) => this.view(m, userId)) };
  }

  async moderate(userId: string, eventId: string, memoryId: string, approve: boolean) {
    const event = await this.events.ownedEvent(userId, eventId);
    if (!Types.ObjectId.isValid(memoryId)) throw new NotFoundException('Memory not found');
    const memory = await this.memoryModel.findOne({ _id: memoryId, event: event._id }).exec();
    if (!memory) throw new NotFoundException('Memory not found');
    memory.status = approve ? EventMemoryStatus.VISIBLE : EventMemoryStatus.REJECTED;
    await memory.save();
    return this.view(memory, userId);
  }

  /* -------------------------------------------------------------- helpers */

  private async publicEvent(eventId: string): Promise<PublicEventDocument> {
    if (!Types.ObjectId.isValid(eventId)) throw new NotFoundException('Event not found');
    const event = await this.eventModel
      .findOne({ _id: eventId, status: { $in: PUBLIC_STATUSES } })
      .exec();
    if (!event) throw new NotFoundException('Event not found');
    return event;
  }

  private view(m: EventMemoryDocument, userId: string) {
    return {
      id: m._id.toString(),
      kind: m.kind,
      url: m.url,
      caption: m.caption,
      status: m.status,
      mine: m.uploader.toString() === userId,
      createdAt: (m.get('createdAt') as Date | undefined)?.toISOString?.() ?? null,
    };
  }
}
