import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { MessageService } from './message.service';
import { SendMessageDto } from './dto/send-message.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

/**
 * Messaging between a customer and an organizer.
 *
 * Every route is scoped to the signed-in account, and the service decides
 * which side of a thread that account is on. There is no route that takes a
 * customer or organizer id to act *as* — the session is the only identity.
 */
@Controller('message')
export class MessageController {
  constructor(private readonly messageService: MessageService) {}

  /** The customer's inbox. */
  @Get('mine')
  listMine(@CurrentUser('userId') userId: string) {
    return this.messageService.listForCustomer(userId);
  }

  /** The organizer's inbox, for the same account in its organizer view. */
  @Get('organizer')
  listForOrganizer(@CurrentUser('userId') userId: string) {
    return this.messageService.listForOrganizer(userId);
  }

  /** Unread across every thread — what the Chat tab badges. */
  @Get('unread-count')
  unreadCount(@CurrentUser('userId') userId: string) {
    return this.messageService.unreadCount(userId);
  }

  /**
   * Opens the thread with one organizer, creating it on first contact.
   * A POST because it can create; idempotent, so a repeat tap is harmless.
   */
  @Post('with-organizer/:organizerId')
  openWithOrganizer(
    @CurrentUser('userId') userId: string,
    @Param('organizerId') organizerId: string,
  ) {
    return this.messageService.openWithOrganizer(userId, organizerId);
  }

  /** The messages in a thread. Reading it marks the reader's side read. */
  @Get(':conversationId')
  messages(@CurrentUser('userId') userId: string, @Param('conversationId') conversationId: string) {
    return this.messageService.messages(userId, conversationId);
  }

  @Post(':conversationId')
  send(
    @CurrentUser('userId') userId: string,
    @Param('conversationId') conversationId: string,
    @Body() dto: SendMessageDto,
  ) {
    return this.messageService.send(userId, conversationId, dto.text);
  }
}
