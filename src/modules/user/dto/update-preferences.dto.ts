import { IsBoolean, IsOptional } from 'class-validator';

/**
 * What a customer may change about being notified.
 *
 * Deliberately its own DTO rather than fields on UpdateProfileDto: the global
 * pipe strips undeclared properties but not declared ones, so whatever is
 * named here is writable by the caller. Keeping this to three booleans means a
 * request to the preferences route can never touch a name, a role or a status.
 */
export class UpdatePreferencesDto {
  @IsOptional()
  @IsBoolean()
  quotes?: boolean;

  @IsOptional()
  @IsBoolean()
  invitations?: boolean;

  @IsOptional()
  @IsBoolean()
  marketing?: boolean;
}
