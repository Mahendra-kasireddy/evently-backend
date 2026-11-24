import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class InviteAdminDto {
  @IsString()
  @MinLength(2, { message: 'Enter their name' })
  @MaxLength(80)
  name: string;

  /** 10 digits, no dial code — the same rule as `SendOtpDto`. */
  @IsString()
  @Matches(/^\d{10}$/, { message: 'Enter a valid 10-digit mobile number' })
  mobile: string;
}
