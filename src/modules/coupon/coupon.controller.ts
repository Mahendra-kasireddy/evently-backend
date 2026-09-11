import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { CouponService } from './coupon.service';
import { AvailableCouponsDto } from './dto/available-coupons.dto';
import { PreviewCouponDto } from './dto/apply-coupon.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

/**
 * Coupons, from the customer's side.
 *
 * Both routes take a quotation, never an amount: the total and the organizer
 * are read from that quotation on the server, and the quotation is loaded
 * through the same ownership check the booking write uses. A customer cannot
 * price a coupon against a booking that is not theirs, or against a number
 * they invented.
 *
 * Neither route changes anything. The coupon is only spent when the booking is
 * created — see `BookingService.createFromQuotation`.
 */
@Controller('coupon')
export class CouponController {
  constructor(private readonly couponService: CouponService) {}

  /** Coupons this customer can actually use on this quotation, best first. */
  @Get('available')
  available(@CurrentUser('userId') userId: string, @Query() query: AvailableCouponsDto) {
    return this.couponService.listAvailable(userId, query.quotationId);
  }

  /** What a typed code is worth here — or a 400 saying why it is refused. */
  @Post('preview')
  preview(@CurrentUser('userId') userId: string, @Body() dto: PreviewCouponDto) {
    return this.couponService.preview(userId, dto.quotationId, dto.code);
  }
}
