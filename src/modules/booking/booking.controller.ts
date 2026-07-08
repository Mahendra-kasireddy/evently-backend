import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { BookingService } from './booking.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { UpdateBookingDto } from './dto/update-booking.dto';
import { UpdateBookingStatusDto } from './dto/update-booking-status.dto';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@Controller('booking')
export class BookingController {
  constructor(private readonly bookingService: BookingService) {}

  /** The customer's active booking for the home card (null when none). */
  @Get('getMyActiveBooking')
  getMyActiveBooking(@CurrentUser('userId') userId: string) {
    return this.bookingService.getActiveForUser(userId);
  }

  /** The customer's bookings (history), newest first. */
  @Get('my-bookings')
  myBookings(@CurrentUser('userId') userId: string) {
    return this.bookingService.findMine(userId);
  }

  /** Create a booking from an accepted quotation (idempotent per quotation). */
  @Post()
  create(@CurrentUser('userId') userId: string, @Body() dto: CreateBookingDto) {
    return this.bookingService.createFromQuotation(userId, dto);
  }

  /** A single booking with its timeline. */
  @Get(':id')
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.bookingService.findOne(user, id);
  }

  /** Edit booking details (owner or organizer). */
  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateBookingDto) {
    return this.bookingService.update(user, id, dto);
  }

  /** Transition a booking's status. */
  @Patch(':id/status')
  updateStatus(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateBookingStatusDto,
  ) {
    return this.bookingService.updateStatus(user, id, dto);
  }

  /** Delete a pending/closed booking the customer owns. */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser('userId') userId: string, @Param('id') id: string) {
    return this.bookingService.remove(userId, id);
  }
}
