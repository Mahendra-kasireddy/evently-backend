import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * What a customer may change on a section they own: the wording guests read,
 * and whether the section appears at all.
 *
 * Deliberately narrower than the organizer's `UpdateInvitationDto` — the
 * customer cannot retitle a section, change its icon, reassign its owner or
 * touch event-level details. Those stay with the organizer who assembled it.
 */
export class PersonalizeBlockDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  heading?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  body?: string;

  @IsOptional()
  @IsBoolean()
  hidden?: boolean;
}
