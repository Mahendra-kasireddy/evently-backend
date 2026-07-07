import { Controller, Get } from '@nestjs/common';
import { BookingService } from './booking.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('booking')
export class BookingController {
  constructor(private readonly bookingService: BookingService) {}

  /**
   * The current customer's active booking for the home card.
   * Authenticated (global JwtAuthGuard) — returns null when there's none.
   */
  @Get('getMyActiveBooking')
  getMyActiveBooking(@CurrentUser('userId') userId: string) {
    return this.bookingService.getActiveForUser(userId);
  }
}
