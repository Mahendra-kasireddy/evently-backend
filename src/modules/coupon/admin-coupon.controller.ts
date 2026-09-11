import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CouponService } from './coupon.service';
import { CouponTermsDto } from './dto/coupon-terms.dto';
import { UpdateCouponDto } from './dto/update-coupon.dto';
import { UpdateCouponStatusDto } from './dto/update-coupon-status.dto';
import { ListCouponsDto } from './dto/list-coupons.dto';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

/**
 * Platform coupons, and oversight of every other kind.
 *
 * Admins issue platform coupons and can disable any coupon on the marketplace,
 * including an organizer's — the lever that matters when one is being abused.
 * They do not *create* organizer coupons: `createCoupon` has no scope field, so
 * everything this controller creates is a platform coupon, and an organizer's
 * coupon stays the organizer's.
 *
 * Authorization is the class-level guard, as with every other admin surface.
 */
@Controller('admin/coupon')
@UseGuards(RolesGuard)
@Roles(Role.ADMIN)
export class AdminCouponController {
  constructor(private readonly couponService: CouponService) {}

  @Get('getCoupons')
  getCoupons(@Query() query: ListCouponsDto) {
    return this.couponService.adminList(query);
  }

  @Get('getStatusCounts')
  getStatusCounts() {
    return this.couponService.adminCounts();
  }

  @Get('getCouponById/:id')
  getCouponById(@Param('id') id: string) {
    return this.couponService.adminDetail(id);
  }

  /** Who spent this coupon, on what, for how much. */
  @Get('getUsage/:id')
  getUsage(@Param('id') id: string) {
    return this.couponService.usageForCoupon(id);
  }

  @Post('createCoupon')
  createCoupon(@CurrentUser('userId') userId: string, @Body() dto: CouponTermsDto) {
    return this.couponService.createPlatform(userId, dto);
  }

  @Patch('updateCoupon/:id')
  updateCoupon(@Param('id') id: string, @Body() dto: UpdateCouponDto) {
    return this.couponService.adminUpdate(id, dto);
  }

  @Patch('updateStatus/:id')
  updateStatus(@Param('id') id: string, @Body() dto: UpdateCouponStatusDto) {
    return this.couponService.adminSetStatus(id, dto.status);
  }
}
