import { ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import { EventMemoryService } from './event-memory.service';
import { EventMemoryStatus } from './schemas/event-memory.schema';
import { MemoryUploaders, PublicEventStatus } from './public-event.constants';

const userId = new Types.ObjectId().toString();
const eventId = new Types.ObjectId();

function eventWith(memories: Record<string, unknown>) {
  return {
    _id: eventId,
    status: PublicEventStatus.PUBLISHED,
    startDateTime: new Date(Date.now() - 60 * 60 * 1000),
    endDateTime: null,
    memories: {
      enabled: true,
      uploaders: MemoryUploaders.TICKET_HOLDERS,
      attendeeView: true,
      attendeeDownload: false,
      moderation: false,
      uploadWindowDays: 7,
      ...memories,
    },
  };
}

function build(opts: {
  event: ReturnType<typeof eventWith>;
  standing: { hasTicket: boolean; checkedIn: boolean };
}) {
  const created: Record<string, unknown>[] = [];
  const found: { filter?: unknown } = {};
  const memoryModel = {
    find: jest.fn((filter: unknown) => {
      found.filter = filter;
      return { sort: () => ({ limit: () => ({ exec: async () => [] }) }) };
    }),
    create: jest.fn(async (doc: Record<string, unknown>) => {
      created.push(doc);
      return {
        ...doc,
        _id: new Types.ObjectId(),
        uploader: doc.uploader,
        get: () => new Date(),
      };
    }),
  };
  const eventModel = { findOne: () => ({ exec: async () => opts.event }) };
  const customers = { standingFor: jest.fn(async () => opts.standing) };
  const events = { ownedEvent: jest.fn() };
  const uploads = {
    upload: jest.fn(async () => ({ url: 'https://cdn/x.jpg', key: 'memoryPhoto/x.jpg' })),
  };
  const service = new EventMemoryService(
    memoryModel as never,
    eventModel as never,
    customers as never,
    events as never,
    uploads as never,
  );
  return { service, created, found, uploads };
}

const photo = { mimetype: 'image/jpeg', buffer: Buffer.from('x') } as Express.Multer.File;

describe('EventMemoryService', () => {
  it('refuses the gallery to somebody without a ticket', async () => {
    const { service } = build({
      event: eventWith({}),
      standing: { hasTicket: false, checkedIn: false },
    });
    await expect(service.list(eventId.toString(), userId)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('refuses an upload the event’s rules do not allow, before storing anything', async () => {
    const { service, uploads } = build({
      event: eventWith({ uploaders: MemoryUploaders.CHECKED_IN }),
      standing: { hasTicket: true, checkedIn: false },
    });
    await expect(service.upload(eventId.toString(), userId, photo)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(uploads.upload).not.toHaveBeenCalled();
  });

  it('publishes straight away when the event does not moderate', async () => {
    const { service, created } = build({
      event: eventWith({}),
      standing: { hasTicket: true, checkedIn: false },
    });
    await service.upload(eventId.toString(), userId, photo);
    expect(created[0].status).toBe(EventMemoryStatus.VISIBLE);
    expect(created[0].kind).toBe('photo');
  });

  it('holds an upload for the organizer when the event moderates', async () => {
    const { service, created } = build({
      event: eventWith({ moderation: true }),
      standing: { hasTicket: true, checkedIn: false },
    });
    await service.upload(eventId.toString(), userId, photo);
    expect(created[0].status).toBe(EventMemoryStatus.PENDING);
  });

  it('shows pending memories only to the person who added them', async () => {
    const { service, found } = build({
      event: eventWith({}),
      standing: { hasTicket: true, checkedIn: false },
    });
    await service.list(eventId.toString(), userId);
    const filter = found.filter as { $or: Array<Record<string, unknown>> };
    const pending = filter.$or.find((c) => c.status === EventMemoryStatus.PENDING)!;
    expect(String(pending.uploader)).toBe(userId);
  });
});
