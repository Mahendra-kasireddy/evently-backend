import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { CouponDiscountType } from '../schemas/coupon.schema';

/**
 * The terms of a coupon — everything both an admin and an organizer may set.
 *
 * What is *not* here is the access control. The global `ValidationPipe` runs
 * with `whitelist: true`, so a property no DTO declares is stripped before the
 * service ever sees it. `scope`, `organizer`, `usedCount`, `createdBy` and
 * `createdByRole` are therefore unreachable from any request body: they are
 * decided by which controller was called and by the session on it.
 */
export class CouponTermsDto {
  /**
   * Letters and digits only, 4–20 characters.
   *
   * Bounded because it is typed by hand at checkout and matched exactly;
   * punctuation and spaces would make a code that only its author can enter.
   */
  @IsString()
  @MinLength(4)
  @MaxLength(20)
  @Matches(/^[A-Za-z0-9]+$/, {
    message: 'code must contain only letters and numbers',
  })
  code: string;

  @IsString()
  @MinLength(3)
  @MaxLength(80)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  @IsEnum(CouponDiscountType)
  discountType: CouponDiscountType;

  /**
   * Bounded at 100 so a percentage cannot exceed the whole booking. A fixed
   * discount larger than the booking is allowed here and clamped when the
   * discount is computed — the customer pays zero, never a negative.
   */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  discountValue: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  maxDiscount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  minBookingAmount?: number;

  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @IsOptional()
  @IsDateString()
  endsAt?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  usageLimit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000)
  perCustomerLimit?: number;
}
