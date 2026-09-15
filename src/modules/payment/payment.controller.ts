import { Body, Controller, Headers, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { PaymentService } from './payment.service';
import { CreatePaymentOrderDto } from './dto/create-payment-order.dto';
import { VerifyPaymentDto } from './dto/verify-payment.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';

/**
 * Taking the advance.
 *
 * Two authenticated routes for the customer's own flow, and one public route
 * that only Razorpay can use — it carries no session, and is trusted solely
 * because its body verifies against the webhook secret.
 */
@Controller('payment')
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  /** What is owed, and the Razorpay order to pay it with. Charges nothing. */
  @Post('order')
  createOrder(@CurrentUser('userId') userId: string, @Body() dto: CreatePaymentOrderDto) {
    return this.paymentService.createOrder(userId, dto);
  }

  /**
   * Confirms the checkout result and returns the booking it paid for.
   *
   * The booking is created here rather than by a separate call, so there is no
   * moment in which the money has moved and no event exists.
   */
  @Post('verify')
  verify(@CurrentUser('userId') userId: string, @Body() dto: VerifyPaymentDto) {
    return this.paymentService.verifyAndBook(userId, dto);
  }

  /**
   * Razorpay's account of the payment.
   *
   * Public because Razorpay has no session, and verified by signature over the
   * raw body — which is why `rawBody` is enabled on the app. Parsing the body
   * first and re-serialising it would change a byte somewhere and fail every
   * signature.
   */
  @Public()
  @Post('webhook')
  webhook(
    @Req() request: Request & { rawBody?: Buffer },
    @Headers('x-razorpay-signature') signature: string,
  ) {
    return this.paymentService.handleWebhook(request.rawBody ?? '', signature ?? '');
  }
}
