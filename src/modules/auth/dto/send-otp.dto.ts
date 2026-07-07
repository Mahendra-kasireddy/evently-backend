import { IsString, Matches } from 'class-validator';

export class SendOtpDto {
  /** 10-digit mobile number (no dial code), matching the frontend form. */
  @IsString()
  @Matches(/^\d{10}$/, { message: 'Enter a valid 10-digit mobile number' })
  mobile: string;
}
