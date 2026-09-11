import { IsMongoId } from 'class-validator';

/** Which coupons this customer could actually use on this quotation. */
export class AvailableCouponsDto {
  @IsMongoId()
  quotationId: string;
}
