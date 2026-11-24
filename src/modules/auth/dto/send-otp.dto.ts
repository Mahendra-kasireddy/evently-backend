import { IsIn, IsOptional, IsString, Matches } from 'class-validator';

export class SendOtpDto {
  /** 10-digit mobile number (no dial code), matching the frontend form. */
  @IsString()
  @Matches(/^\d{10}$/, { message: 'Enter a valid 10-digit mobile number' })
  mobile: string;

  /**
   * 'register' is the business sign-up, which is for new numbers only: a
   * number that already has an account is told to sign in instead, before any
   * SMS goes out. 'admin_signup' is the admin console's sign-up: only a number
   * with a pending admin invite is sent a code. Omitted (or 'login') is the
   * ordinary find-or-create sign-in.
   */
  @IsOptional()
  @IsIn(['login', 'register', 'admin_signup'])
  purpose?: 'login' | 'register' | 'admin_signup';
}
