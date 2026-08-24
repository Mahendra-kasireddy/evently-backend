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
  UseGuards,
} from '@nestjs/common';
import { BookingService } from './booking.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { UpdateBookingDto } from './dto/update-booking.dto';
import { UpdateBookingStatusDto } from './dto/update-booking-status.dto';
import {
  CreateBookingTaskDto,
  UpdateBookingTaskDto,
  RespondTaskAssignmentDto,
} from './dto/booking-task.dto';
import { ToggleBlockedDateDto } from './dto/toggle-blocked-date.dto';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Role } from '../../common/enums/role.enum';

@Controller('booking')
export class BookingController {
  constructor(private readonly bookingService: BookingService) {}

  // ----- Organizer: dashboard / execution board / calendar -----

  @UseGuards(RolesGuard)
  @Roles(Role.ORGANIZER, Role.ADMIN)
  @Get('organizer/dashboard')
  organizerDashboard(@CurrentUser('userId') userId: string) {
    return this.bookingService.getDashboard(userId);
  }

  @UseGuards(RolesGuard)
  @Roles(Role.ORGANIZER, Role.ADMIN)
  @Get('organizer/mine')
  organizerMine(@CurrentUser('userId') userId: string) {
    return this.bookingService.findForOrganizer(userId);
  }

  @UseGuards(RolesGuard)
  @Roles(Role.ORGANIZER, Role.ADMIN)
  @Get('organizer/calendar')
  organizerCalendar(@CurrentUser('userId') userId: string) {
    return this.bookingService.getCalendar(userId);
  }

  @UseGuards(RolesGuard)
  @Roles(Role.ORGANIZER, Role.ADMIN)
  @Post('organizer/blocked-dates')
  blockDate(@CurrentUser('userId') userId: string, @Body() dto: ToggleBlockedDateDto) {
    return this.bookingService.setDateBlocked(userId, new Date(dto.date), dto.blocked);
  }

  @UseGuards(RolesGuard)
  @Roles(Role.ORGANIZER, Role.ADMIN)
  @Get('organizer/badges')
  organizerBadges(@CurrentUser('userId') userId: string) {
    return this.bookingService.getBadgeStatus(userId);
  }

  @UseGuards(RolesGuard)
  @Roles(Role.ORGANIZER, Role.ADMIN)
  @Get('organizer/earnings')
  organizerEarnings(@CurrentUser('userId') userId: string) {
    return this.bookingService.getEarnings(userId);
  }

  @UseGuards(RolesGuard)
  @Roles(Role.ORGANIZER, Role.ADMIN)
  @Get('organizer/subvendors')
  organizerSubvendors(@CurrentUser('userId') userId: string) {
    return this.bookingService.getSubVendorsForOrganizer(userId);
  }

  @UseGuards(RolesGuard)
  @Roles(Role.ORGANIZER, Role.ADMIN)
  @Post(':id/tasks')
  addTask(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
    @Body() dto: CreateBookingTaskDto,
  ) {
    return this.bookingService.addTask(userId, id, dto);
  }

  @UseGuards(RolesGuard)
  @Roles(Role.ORGANIZER, Role.ADMIN)
  @Patch(':id/tasks/:taskId')
  updateTask(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
    @Param('taskId') taskId: string,
    @Body() dto: UpdateBookingTaskDto,
  ) {
    return this.bookingService.updateTask(userId, id, taskId, dto);
  }

  @UseGuards(RolesGuard)
  @Roles(Role.ORGANIZER, Role.ADMIN)
  @Delete(':id/tasks/:taskId')
  removeTask(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
    @Param('taskId') taskId: string,
  ) {
    return this.bookingService.removeTask(userId, id, taskId);
  }

  // ----- Sub-vendor: my tasks / accept-decline / status updates -----

  @UseGuards(RolesGuard)
  @Roles(Role.VENDOR, Role.ADMIN)
  @Get('subvendor/mine')
  subVendorMine(@CurrentUser('userId') userId: string) {
    return this.bookingService.findTasksForSubVendor(userId);
  }

  @UseGuards(RolesGuard)
  @Roles(Role.VENDOR, Role.ADMIN)
  @Get('subvendor/performance')
  subVendorPerformance(@CurrentUser('userId') userId: string) {
    return this.bookingService.getSubVendorPerformance(userId);
  }

  @UseGuards(RolesGuard)
  @Roles(Role.VENDOR, Role.ADMIN)
  @Patch('subvendor/:bookingId/tasks/:taskId/respond')
  respondToTask(
    @CurrentUser('userId') userId: string,
    @Param('bookingId') bookingId: string,
    @Param('taskId') taskId: string,
    @Body() dto: RespondTaskAssignmentDto,
  ) {
    return this.bookingService.respondToTaskAssignment(userId, bookingId, taskId, dto.accept);
  }

  @UseGuards(RolesGuard)
  @Roles(Role.VENDOR, Role.ADMIN)
  @Patch('subvendor/:bookingId/tasks/:taskId')
  updateOwnTask(
    @CurrentUser('userId') userId: string,
    @Param('bookingId') bookingId: string,
    @Param('taskId') taskId: string,
    @Body() dto: UpdateBookingTaskDto,
  ) {
    return this.bookingService.updateTaskAsSubVendor(userId, bookingId, taskId, dto);
  }

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
