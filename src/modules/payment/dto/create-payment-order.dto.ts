import { IsMongoId, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Start a payment for an accepted quotation.
 *
 * There is deliberately no amount. The quotation's total, the coupon's
 * discount and the advance share are all read on the server, so what the
 * customer is charged cannot be chosen by the app that asks.
 */
export class CreatePaymentOrderDto {
  @IsMongoId()
  quotationId: string;

  @IsOptional()
  @IsString()
  @MinLength(4)
  @MaxLength(20)
  couponCode?: string;
}
