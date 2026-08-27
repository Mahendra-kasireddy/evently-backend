import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { SubVendorCategory } from '../schemas/subvendor-profile.schema';

/** Admin sub-vendor list query: ?category=&active=&search=&page=&limit= */
export class ListSubVendorsDto extends PaginationDto {
  @IsOptional()
  @IsEnum(SubVendorCategory, { message: 'Unknown vendor category' })
  category?: SubVendorCategory;

  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean({ message: 'active must be true or false' })
  active?: boolean;

  /** Matches full name or service area. */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  search?: string;
}
