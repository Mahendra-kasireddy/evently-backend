import { Type } from 'class-transformer';
import { IsOptional, IsString, Matches, MaxLength, ValidateNested } from 'class-validator';
import { StoredFileDto } from './stored-file.dto';

const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const UPI_RE = /^[\w.-]{2,256}@[a-zA-Z]{2,64}$/;

/**
 * Step 3 (Bank details) update. All fields optional for autosave. Account-number
 * confirmation is validated on the client (the confirm value is never persisted).
 */
export class UpdateBankDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  accountHolderName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  bankName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  branchName?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[0-9]{6,20}$/, { message: 'Account number must be 6–20 digits' })
  accountNumber?: string;

  @IsOptional()
  @IsString()
  @Matches(IFSC_RE, { message: 'Enter a valid IFSC (e.g. HDFC0001234)' })
  ifsc?: string;

  @IsOptional()
  @IsString()
  @Matches(UPI_RE, { message: 'Enter a valid UPI ID (e.g. name@bank)' })
  upiId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => StoredFileDto)
  cancelledChequeFile?: StoredFileDto;
}
