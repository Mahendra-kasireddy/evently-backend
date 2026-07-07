import { IsString, Matches } from 'class-validator';

export class VerifyOtpDto {
  /** The requestId returned by sendOtp. */
  @IsString()
  requestId: string;

  @IsString()
  @Matches(/^\d{6}$/, { message: 'Enter the 6-digit code' })
  code: string;
}
