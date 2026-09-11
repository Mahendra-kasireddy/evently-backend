import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { CouponScope, CouponStatus } from '../schemas/coupon.schema';

/** The admin coupon list: search by code or title, filter by scope/status. */
export class ListCouponsDto extends PaginationDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  search?: string;

  @IsOptional()
  @IsEnum(CouponScope)
  scope?: CouponScope;

  @IsOptional()
  @IsEnum(CouponStatus)
  status?: CouponStatus;
}
