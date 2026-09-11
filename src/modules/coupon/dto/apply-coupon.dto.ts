import { IsMongoId, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Ask what a code is worth on a quotation.
 *
 * The amount is deliberately absent. It is read from the quotation on the
 * server, so a client cannot preview — or book at — a discount computed from a
 * total it made up.
 */
export class PreviewCouponDto {
  @IsMongoId()
  quotationId: string;

  @IsString()
  @MinLength(4)
  @MaxLength(20)
  code: string;
}
