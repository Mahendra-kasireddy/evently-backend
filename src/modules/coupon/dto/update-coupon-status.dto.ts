import { IsEnum } from 'class-validator';
import { CouponStatus } from '../schemas/coupon.schema';

/** Enable or disable a coupon. Its own route, so an edit cannot flip it. */
export class UpdateCouponStatusDto {
  @IsEnum(CouponStatus)
  status: CouponStatus;
}
