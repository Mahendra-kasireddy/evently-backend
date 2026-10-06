import { PartialType, OmitType } from '@nestjs/mapped-types';
import { IsEnum, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { CreateUserDto } from './create-user.dto';
import { UserStatus } from '../schemas/user.schema';

/**
 * Home city. Deliberately not on CreateUserDto — it is never needed to create
 * an account. It is collected during onboarding, changeable from the header,
 * and it is what "organizers near you" matches on.
 */
const CITY_MAX = 120;

/**
 * The shape of a profile photo URL: the local driver's `/api/upload/file/<key>`
 * path (no `..`), or an https URL. Shape only — that an https URL is on
 * Evently's own upload host is checked in `UserService.assertOwnUpload`,
 * which knows the configured host.
 */
const PROFILE_PHOTO_URL = /^(?!.*\.\.)(\/api\/upload\/file\/[\w./-]+|https:\/\/\S+)$/;

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

  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Matches(PROFILE_PHOTO_URL, { message: 'Upload your photo through Evently' })
  photoUrl?: string;
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
