import { IsEmail, IsEnum, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Role } from '../../../common/enums/role.enum';

/**
 * Public self-registration. Only customer/organizer/vendor may be chosen here;
 * admin is granted out-of-band. Defaults to customer.
 */
export class RegisterDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password: string;

  @IsOptional()
  @IsEnum(Role)
  @IsIn([Role.CUSTOMER, Role.ORGANIZER, Role.VENDOR])
  role?: Role;
}
