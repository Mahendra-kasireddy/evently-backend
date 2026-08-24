import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { BlockOwner } from '../schemas/invitation.schema';
import { INVITATION_TEMPLATES } from '../invitation-defaults';

const TEMPLATE_IDS = INVITATION_TEMPLATES.map((t) => t.id);

/** `yyyy-mm-dd`, or empty for "not set yet". */
const DATE_RE = /^$|^\d{4}-\d{2}-\d{2}$/;
/** `HH:mm`, or empty. */
const TIME_RE = /^$|^([01]\d|2[0-3]):[0-5]\d$/;

export class InvitationDetailsDto {
  @IsOptional()
  @IsIn(TEMPLATE_IDS)
  template?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  eyebrow?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  hostOne?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  hostTwo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  joiner?: string;

  @IsOptional()
  @Matches(DATE_RE, { message: 'eventDate must be yyyy-mm-dd' })
  eventDate?: string;

  @IsOptional()
  @Matches(TIME_RE, { message: 'eventTime must be HH:mm' })
  eventTime?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  venueName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  venueAddress?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  message?: string;

  @IsOptional()
  @IsBoolean()
  rsvpEnabled?: boolean;

  @IsOptional()
  @Matches(DATE_RE, { message: 'rsvpDeadline must be yyyy-mm-dd' })
  rsvpDeadline?: string;

  @IsOptional()
  @IsBoolean()
  rsvpPlusOnes?: boolean;
}

export class InvitationBlockDto {
  @IsString()
  @MaxLength(60)
  key: string;

  @IsString()
  @MaxLength(80)
  title: string;

  @IsString()
  @MaxLength(30)
  icon: string;

  @IsEnum(BlockOwner)
  owner: BlockOwner;

  @IsBoolean()
  hidden: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  heading?: string;

  @IsOptional()
  @IsString()
  @MaxLength(600)
  body?: string;
}

/**
 * Partial update of one invitation. `blocks`, when present, replaces the whole
 * list — the builder reorders, adds and hides sections, so a full replacement
 * is both simpler and race-free compared with per-block patches.
 */
export class UpdateInvitationDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => InvitationDetailsDto)
  details?: InvitationDetailsDto;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InvitationBlockDto)
  blocks?: InvitationBlockDto[];
}
