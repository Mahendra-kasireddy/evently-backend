import { IsMongoId, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** Create a booking from an accepted quotation. */
export class CreateBookingDto {
  @IsMongoId()
  quotationId: string;

  /**
   * A coupon code, if the customer applied one.
   *
   * The code is all the client may send. There is deliberately no discount or
   * final-amount field: both are recomputed here from the quotation before the
   * booking is written, so what the checkout screen displayed can never be
   * what the customer is charged.
   */
  @IsOptional()
  @IsString()
  @MinLength(4)
  @MaxLength(20)
  couponCode?: string;
}
