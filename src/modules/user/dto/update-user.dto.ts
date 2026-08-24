import { PartialType, OmitType } from '@nestjs/mapped-types';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { CreateUserDto } from './create-user.dto';
import { UserStatus } from '../schemas/user.schema';

/**
 * Home city. Deliberately not on CreateUserDto — it is never needed to create
 * an account. It is collected during onboarding, changeable from the header,
 * and it is what "organizers near you" matches on.
 */
const CITY_MAX = 120;

/**
 * What a user may change about their own account.
 *
 * `roles` and `status` are deliberately absent, and their absence is the whole
 * security control: the global pipe runs with `whitelist: true`, which strips
 * properties that are *not declared on the DTO*. It does not strip declared
 * ones. Since `UserService.update` passes the validated DTO straight to
 * `findByIdAndUpdate`, anything declared here is writable by the caller.
 *
 * Inheriting `roles` from `CreateUserDto` (as this DTO used to) therefore let
 * any authenticated user PATCH themselves to `roles: ['admin']` and mint an
 * admin token from `refreshToken`, and let a suspended account restore its own
 * `status`. Keep both fields on the admin DTO below only.
 */
export class UpdateProfileDto extends PartialType(
  OmitType(CreateUserDto, ['password', 'roles'] as const),
) {
  @IsOptional()
  @IsString()
  @MaxLength(CITY_MAX)
  city?: string;
}

/**
 * Administrative update of any user: the self-service set plus the two
 * privileged fields. Only reachable from an `@Roles(Role.ADMIN)` route.
 */
export class UpdateUserDto extends PartialType(OmitType(CreateUserDto, ['password'] as const)) {
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @IsOptional()
  @IsString()
  @MaxLength(CITY_MAX)
  city?: string;
}
