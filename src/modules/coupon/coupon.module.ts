import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CouponService } from './coupon.service';
import { CouponController } from './coupon.controller';
import { OrganizerCouponController } from './organizer-coupon.controller';
import { AdminCouponController } from './admin-coupon.controller';
import { Coupon, CouponSchema } from './schemas/coupon.schema';
import { CouponRedemption, CouponRedemptionSchema } from './schemas/coupon-redemption.schema';
import { QuoteModule } from '../quote/quote.module';
import { OrganizerModule } from '../organizer/organizer.module';

/**
 * Coupons.
 *
 * QuoteModule is imported for one thing: `getBookingSeed`, which is already the
 * function that decides what a quotation is worth and whether the caller owns
 * it. Reusing it is what keeps the coupon preview, the coupon list and the
 * booking write agreeing about the amount — a second reader of the quotation
 * would be a second answer.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Coupon.name, schema: CouponSchema },
      { name: CouponRedemption.name, schema: CouponRedemptionSchema },
    ]),
    QuoteModule,
    OrganizerModule,
  ],
  controllers: [CouponController, OrganizerCouponController, AdminCouponController],
  providers: [CouponService],
  exports: [CouponService],
})
export class CouponModule {}
