import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
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
import { IsIanaTimeZone } from '../../../common/validators/is-iana-timezone.validator';
import { BlockOwner, SubEventVisibility } from '../schemas/invitation.schema';
import { CARD_COLOUR_IDS, INVITATION_TEMPLATES } from '../invitation-defaults';

const TEMPLATE_IDS = INVITATION_TEMPLATES.map((t) => t.id);
/** A card may also carry no colour at all, meaning "follow the template". */
const COLOUR_IDS = ['', ...CARD_COLOUR_IDS];

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

  /** Checked against the runtime's own zone database, not a regex. */
  @IsOptional()
  @IsIanaTimeZone()
  timezone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  postEventMessage?: string;

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

/** One Save-the-Date card. */
export class InvitationSubEventDto {
  @IsString()
  @MaxLength(80)
  name: string;

  @IsOptional()
  @Matches(DATE_RE, { message: 'eventDate must be yyyy-mm-dd' })
  eventDate?: string;

  @IsOptional()
  @Matches(TIME_RE, { message: 'eventTime must be HH:mm' })
  eventTime?: string;

  @IsOptional()
  @Matches(TIME_RE, { message: 'endTime must be HH:mm' })
  endTime?: string;

  @IsOptional()
  @IsIanaTimeZone()
  timezone?: string;

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
  @MaxLength(80)
  dressCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;

  /** A palette id, never a raw colour value the client made up. */
  @IsOptional()
  @IsIn(COLOUR_IDS)
  colour?: string;

  @IsOptional()
  @IsEnum(SubEventVisibility)
  visibility?: SubEventVisibility;
}

/**
 * Partial update of one invitation. `blocks` and `subEvents`, when present,
 * each replace the whole list — the builder reorders, adds and hides them, so a
 * full replacement is both simpler and race-free compared with per-item
 * patches. Array order is the display order.
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

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => InvitationSubEventDto)
  subEvents?: InvitationSubEventDto[];
}
