import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * What Razorpay's checkout hands back on success.
 *
 * The signature is the only part that matters: it is an HMAC of the other two
 * under the key secret, so a client cannot claim a payment it did not make.
 */
export class VerifyPaymentDto {
  @IsString()
  @MinLength(4)
  @MaxLength(120)
  razorpayOrderId: string;

  @IsString()
  @MinLength(4)
  @MaxLength(120)
  razorpayPaymentId: string;

  @IsString()
  @MinLength(8)
  @MaxLength(256)
  razorpaySignature: string;
}
