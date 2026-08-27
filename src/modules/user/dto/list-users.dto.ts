import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { Role } from '../../../common/enums/role.enum';
import { UserStatus } from '../schemas/user.schema';

/** Admin user list query: ?role=&status=&search=&page=&limit= */
export class ListUsersDto extends PaginationDto {
  /** One of the real account roles. Omitted = every role. */
  @IsOptional()
  @IsEnum(Role, { message: 'Unknown role' })
  role?: Role;

  @IsOptional()
  @IsEnum(UserStatus, { message: 'Unknown account status' })
  status?: UserStatus;

  /** Matches name, email or phone. */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  search?: string;
}
