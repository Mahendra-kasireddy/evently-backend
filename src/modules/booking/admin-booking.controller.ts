import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { AdminBookingService } from './admin-booking.service';
import { ListBookingsDto } from './dto/list-bookings.dto';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';

/**
 * Admin-only booking oversight, and the finance derived from it.
 *
 * Read-only. Moving somebody's booking through its lifecycle is the organizer's
 * job and the existing `PATCH /booking/:id/status` already enforces who may do
 * it; giving the console a second route into those transitions would put an
 * admin inside a customer-organizer agreement.
 */
@Controller('admin/booking')
@UseGuards(RolesGuard)
@Roles(Role.ADMIN)
export class AdminBookingController {
  constructor(private readonly adminBookingService: AdminBookingService) {}

  @Get('getBookings')
  getBookings(@Query() query: ListBookingsDto) {
    return this.adminBookingService.list(query);
  }

  @Get('getStatusCounts')
  getStatusCounts() {
    return this.adminBookingService.counts();
  }

  @Get('getBookingById/:id')
  getBookingById(@Param('id') id: string) {
    return this.adminBookingService.detail(id);
  }
}

/**
 * Booking finance.
 *
 * Deliberately its own route prefix so nothing reads it as a payment ledger:
 * Evently records no transactions, so every figure here is summed from booking
 * documents. `collected` is what bookings say was paid, not what a gateway
 * confirms was settled.
 */
@Controller('admin/payment')
@UseGuards(RolesGuard)
@Roles(Role.ADMIN)
export class AdminPaymentController {
  constructor(private readonly adminBookingService: AdminBookingService) {}

  /** The same booking rows, framed by their money. */
  @Get('getPayments')
  getPayments(@Query() query: ListBookingsDto) {
    return this.adminBookingService.list(query);
  }

  /** Totals for the current filter — summed across the slice, not the page. */
  @Get('getTotals')
  getTotals(@Query() query: ListBookingsDto) {
    return this.adminBookingService.totals(query);
  }

  @Get('getStatusCounts')
  getStatusCounts() {
    return this.adminBookingService.counts();
  }
}
