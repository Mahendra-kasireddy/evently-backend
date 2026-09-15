import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PaymentService } from './payment.service';
import { PaymentController } from './payment.controller';
import { PaymentOrder, PaymentOrderSchema } from './schemas/payment-order.schema';
import { QuoteModule } from '../quote/quote.module';
import { CouponModule } from '../coupon/coupon.module';
import { BookingModule } from '../booking/booking.module';

/**
 * Payments.
 *
 * Depends on BookingModule, never the other way round: the booking is written
 * once a payment is verified, and BookingService checks the paid order through
 * the PaymentOrder schema registered in its own module rather than importing
 * this one back.
 */
@Module({
  imports: [
    MongooseModule.forFeature([{ name: PaymentOrder.name, schema: PaymentOrderSchema }]),
    QuoteModule,
    CouponModule,
    forwardRef(() => BookingModule),
  ],
  controllers: [PaymentController],
  providers: [PaymentService],
  exports: [PaymentService],
})
export class PaymentModule {}
