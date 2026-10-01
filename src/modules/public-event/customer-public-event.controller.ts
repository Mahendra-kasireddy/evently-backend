import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Throttle } from '@nestjs/throttler';
import { EventMemoryService } from './event-memory.service';
import { EventMemoryKind } from './schemas/event-memory.schema';
import { CustomerPublicEventService } from './customer-public-event.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import {
  BrowsePublicEventsDto,
  ConfirmEventBookingDto,
  ListMyTicketsDto,
  StartEventBookingDto,
  ListEventMemoriesDto,
  AddEventMemoryDto,
} from './dto/customer-public-event.dto';

/**
 * Public events, as a customer meets them.
 *
 * Deliberately a separate controller from the organizer's. They are different
 * audiences with different rights, and sharing one file is how a draft event
 * ends up one forgotten branch away from being listed.
 *
 * The catalogue and the detail page are open — a public event is public, and a
 * customer should be able to see what is on before they sign in. Everything
 * that costs money or names a person requires a session, and every one of
 * those routes is scoped by the authenticated user on the server.
 */
@Controller('public-event')
export class CustomerPublicEventController {
  constructor(
    private readonly service: CustomerPublicEventService,
    private readonly memories: EventMemoryService,
  ) {}

  /** The catalogue. Published events only — there is no parameter that widens it. */
  @Public()
  @Get('browse')
  browse(@Query() query: BrowsePublicEventsDto) {
    return this.service.browse(query);
  }

  /**
   * One event.
   *
   * Open, but it reads the session when there is one: whether you may upload to
   * the gallery or watch the stream depends on what you hold, and a signed-in
   * customer gets those answers on the same page as the description.
   */
  @Public()
  /* Public, but not anonymous: the global guard steps aside for @Public, so
     without this the session was never read and every customer looked like a
     stranger here — no ticket, no gallery, no stream. This attaches the user
     when a valid token is sent and lets a guest through when it is not. */
  @UseGuards(OptionalJwtAuthGuard)
  @Get('browse/:eventId')
  detail(@Param('eventId') eventId: string, @CurrentUser('userId') userId?: string) {
    return this.service.detail(eventId, userId ?? null);
  }

  /** Hold the seats, then open the payment. In that order, deliberately. */
  @Post('browse/:eventId/book')
  book(
    @CurrentUser('userId') userId: string,
    @Param('eventId') eventId: string,
    @Body() dto: StartEventBookingDto,
  ) {
    return this.service.startBooking(userId, eventId, dto);
  }

  /** Verify the payment this server opened, then mint the tickets. */
  @Post('bookings/:bookingId/confirm')
  confirm(
    @CurrentUser('userId') userId: string,
    @Param('bookingId') bookingId: string,
    @Body() dto: ConfirmEventBookingDto,
  ) {
    return this.service.confirmBooking(userId, bookingId, dto);
  }

  @Get('my-tickets')
  myTickets(@CurrentUser('userId') userId: string, @Query() query: ListMyTicketsDto) {
    return this.service.myTickets(userId, query);
  }

  /** The event's shared gallery. Ticket holders only, per the event's rules. */
  @Get('browse/:eventId/memories')
  listMemories(
    @CurrentUser('userId') userId: string,
    @Param('eventId') eventId: string,
    @Query() query: ListEventMemoriesDto,
  ) {
    return this.memories.list(eventId, userId, query.kind as EventMemoryKind | undefined);
  }

  /** Add a photo or clip — only when the event's upload rules allow this attendee. */
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('browse/:eventId/memories')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 100 * 1024 * 1024, files: 1 },
    }),
  )
  addMemory(
    @CurrentUser('userId') userId: string,
    @Param('eventId') eventId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: AddEventMemoryDto,
  ) {
    return this.memories.upload(eventId, userId, file, dto.caption);
  }

  /** One ticket and its QR — the only route that returns a token, to its owner. */
  @Get('my-tickets/:ticketId')
  ticket(@CurrentUser('userId') userId: string, @Param('ticketId') ticketId: string) {
    return this.service.ticket(userId, ticketId);
  }
}
