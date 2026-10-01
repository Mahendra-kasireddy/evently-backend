import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PublicEventService } from './public-event.service';
import { EventMemoryService } from './event-memory.service';
import { EventMemoryStatus } from './schemas/event-memory.schema';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Role } from '../../common/enums/role.enum';
import {
  ChangeEventStatusDto,
  CheckInDto,
  CreatePublicEventDto,
  EventLiveStreamSettingsDto,
  EventMemoriesSettingsDto,
  ListAttendeesDto,
  ListPublicEventsDto,
  TicketTypeDto,
  UpdatePublicEventDto,
  UpdateTicketTypeDto,
} from './dto/public-event.dto';

/**
 * Everything the organizer's Public Events screens call.
 *
 * One prefix, one role, one identity. Every handler passes the authenticated
 * user id and the event id from the path, and the service turns the first into
 * an organizer and scopes the second by it — so there is no route here that
 * takes an organizer id from the caller, and nothing a client can rename to
 * reach another organizer's event.
 *
 * The customer-facing catalogue is deliberately not in this file. It is a
 * different audience with different rules, and the moment the two share a
 * controller is the moment a draft event becomes one `if` away from public.
 */
@UseGuards(RolesGuard)
@Roles(Role.ORGANIZER, Role.ADMIN)
@Controller('public-event/organizer')
export class OrganizerPublicEventController {
  constructor(
    private readonly service: PublicEventService,
    private readonly memories: EventMemoryService,
  ) {}

  // ----- The events themselves -----

  @Get()
  list(@CurrentUser('userId') userId: string, @Query() query: ListPublicEventsDto) {
    return this.service.list(userId, query);
  }

  @Post()
  create(@CurrentUser('userId') userId: string, @Body() dto: CreatePublicEventDto) {
    return this.service.create(userId, dto);
  }

  @Get(':eventId')
  findOne(@CurrentUser('userId') userId: string, @Param('eventId') eventId: string) {
    return this.service.findOne(userId, eventId);
  }

  @Patch(':eventId')
  update(
    @CurrentUser('userId') userId: string,
    @Param('eventId') eventId: string,
    @Body() dto: UpdatePublicEventDto,
  ) {
    return this.service.update(userId, eventId, dto);
  }

  /** Publish, unpublish back to draft, complete or cancel. */
  @Patch(':eventId/status')
  changeStatus(
    @CurrentUser('userId') userId: string,
    @Param('eventId') eventId: string,
    @Body() dto: ChangeEventStatusDto,
  ) {
    return this.service.changeStatus(userId, eventId, dto);
  }

  // ----- Ticket types -----

  @Get(':eventId/ticket-types')
  listTicketTypes(@CurrentUser('userId') userId: string, @Param('eventId') eventId: string) {
    return this.service.listTicketTypes(userId, eventId);
  }

  @Post(':eventId/ticket-types')
  createTicketType(
    @CurrentUser('userId') userId: string,
    @Param('eventId') eventId: string,
    @Body() dto: TicketTypeDto,
  ) {
    return this.service.createTicketType(userId, eventId, dto);
  }

  @Patch(':eventId/ticket-types/:typeId')
  updateTicketType(
    @CurrentUser('userId') userId: string,
    @Param('eventId') eventId: string,
    @Param('typeId') typeId: string,
    @Body() dto: UpdateTicketTypeDto,
  ) {
    return this.service.updateTicketType(userId, eventId, typeId, dto);
  }

  @Delete(':eventId/ticket-types/:typeId')
  archiveTicketType(
    @CurrentUser('userId') userId: string,
    @Param('eventId') eventId: string,
    @Param('typeId') typeId: string,
  ) {
    return this.service.archiveTicketType(userId, eventId, typeId);
  }

  // ----- The dashboard, the door, and who is coming -----

  @Get(':eventId/dashboard')
  dashboard(@CurrentUser('userId') userId: string, @Param('eventId') eventId: string) {
    return this.service.dashboard(userId, eventId);
  }

  @Get(':eventId/attendees')
  attendees(
    @CurrentUser('userId') userId: string,
    @Param('eventId') eventId: string,
    @Query() query: ListAttendeesDto,
  ) {
    return this.service.attendees(userId, eventId, query);
  }

  /**
   * POST rather than GET: admitting somebody changes the world, and a GET that
   * does is one a browser or a proxy is free to repeat on its own.
   */
  @Post(':eventId/check-in')
  checkIn(
    @CurrentUser('userId') userId: string,
    @Param('eventId') eventId: string,
    @Body() dto: CheckInDto,
  ) {
    return this.service.checkIn(userId, eventId, dto);
  }

  // ----- Memories and the stream -----

  @Patch(':eventId/memories')
  setMemories(
    @CurrentUser('userId') userId: string,
    @Param('eventId') eventId: string,
    @Body() dto: EventMemoriesSettingsDto,
  ) {
    return this.service.setMemories(userId, eventId, dto);
  }

  /** Everything attendees added, optionally only what awaits approval. */
  @Get(':eventId/memories')
  listMemories(
    @CurrentUser('userId') userId: string,
    @Param('eventId') eventId: string,
    @Query('status') status?: string,
  ) {
    const known = Object.values(EventMemoryStatus) as string[];
    return this.memories.listForOrganizer(
      userId,
      eventId,
      status && known.includes(status) ? (status as EventMemoryStatus) : undefined,
    );
  }

  @Post(':eventId/memories/:memoryId/approve')
  approveMemory(
    @CurrentUser('userId') userId: string,
    @Param('eventId') eventId: string,
    @Param('memoryId') memoryId: string,
  ) {
    return this.memories.moderate(userId, eventId, memoryId, true);
  }

  @Post(':eventId/memories/:memoryId/reject')
  rejectMemory(
    @CurrentUser('userId') userId: string,
    @Param('eventId') eventId: string,
    @Param('memoryId') memoryId: string,
  ) {
    return this.memories.moderate(userId, eventId, memoryId, false);
  }

  @Patch(':eventId/live-stream')
  setLiveStream(
    @CurrentUser('userId') userId: string,
    @Param('eventId') eventId: string,
    @Body() dto: EventLiveStreamSettingsDto,
  ) {
    return this.service.setLiveStream(userId, eventId, dto);
  }
}
