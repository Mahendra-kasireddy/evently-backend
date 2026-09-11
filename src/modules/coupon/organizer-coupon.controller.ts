import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { CouponService } from './coupon.service';
import { CouponTermsDto } from './dto/coupon-terms.dto';
import { UpdateCouponDto } from './dto/update-coupon.dto';
import { UpdateCouponStatusDto } from './dto/update-coupon-status.dto';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

/**
 * An organizer's own coupons.
 *
 * The organizer is never a parameter. Every route resolves the profile from
 * the session (`OrganizerService.findByUser`), so there is no request in which
 * an organizer id could be supplied — and `CouponTermsDto` does not declare
 * `scope`, `organizer` or `status`, so the global `ValidationPipe` strips them
 * from the body before the service is reached. The scope is set by the fact
 * that this controller was the one called.
 *
 * These coupons are live as soon as they are created. Organizers already set
 * their own quotation totals with no admin review, and the platform's cut is a
 * function of their tier rather than of their price, so there is nothing for an
 * approval step to protect.
 */
@Controller('coupon/organizer')
@UseGuards(RolesGuard)
@Roles(Role.ORGANIZER, Role.ADMIN)
export class OrganizerCouponController {
  constructor(private readonly couponService: CouponService) {}

  @Get('mine')
  mine(@CurrentUser('userId') userId: string) {
    return this.couponService.listForOrganizer(userId);
  }

  /** Every redemption of this organizer's coupons, on their own bookings. */
  @Get('usage')
  usage(@CurrentUser('userId') userId: string) {
    return this.couponService.usageForOrganizer(userId);
  }

  @Post()
  create(@CurrentUser('userId') userId: string, @Body() dto: CouponTermsDto) {
    return this.couponService.createForOrganizer(userId, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCouponDto,
  ) {
    return this.couponService.updateForOrganizer(userId, id, dto);
  }

  /** Its own route, so an edit can never quietly re-enable a coupon. */
  @Patch(':id/status')
  setStatus(
    @CurrentUser('userId') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCouponStatusDto,
  ) {
    return this.couponService.setStatusForOrganizer(userId, id, dto.status);
  }
}
