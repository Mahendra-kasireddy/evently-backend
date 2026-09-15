import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BookingService } from './booking.service';
import { AdminBookingService } from './admin-booking.service';
import { BookingController } from './booking.controller';
import { AdminBookingController, AdminPaymentController } from './admin-booking.controller';
import { Booking, BookingSchema } from './schemas/booking.schema';
import { Invitation, InvitationSchema } from '../invitation/schemas/invitation.schema';
import { PaymentOrder, PaymentOrderSchema } from '../payment/schemas/payment-order.schema';
import { PaymentModule } from '../payment/payment.module';
import { QuoteModule } from '../quote/quote.module';
import { CouponModule } from '../coupon/coupon.module';
import { OrganizerModule } from '../organizer/organizer.module';
import { SubvendorModule } from '../subvendor/subvendor.module';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Booking.name, schema: BookingSchema },
      // Registered (not the whole InvitationModule) so the home card can read an
      // invitation's approval state without creating a module cycle.
      { name: Invitation.name, schema: InvitationSchema },
      // Read-only: a booking is refused unless a paid order backs it. The
      // owning module depends on this one, so only the schema is registered.
      { name: PaymentOrder.name, schema: PaymentOrderSchema },
    ]),
    QuoteModule,
    // Coupons are validated and spent here, never by the client.
    CouponModule,
    // Circular by nature: a payment makes a booking, and a dead booking
    // refunds its payment. See BookingService's refund calls.
    forwardRef(() => PaymentModule),
    OrganizerModule,
    SubvendorModule,
    NotificationModule,
  ],
  controllers: [BookingController, AdminBookingController, AdminPaymentController],
  providers: [BookingService, AdminBookingService],
  exports: [BookingService],
})
export class BookingModule {}
