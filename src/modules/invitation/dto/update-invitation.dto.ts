import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { IsIanaTimeZone } from '../../../common/validators/is-iana-timezone.validator';
import { IsEmbeddableStreamUrl } from '../../../common/validators/is-embeddable-stream-url.validator';
import { BlockOwner, SubEventVisibility } from '../schemas/invitation.schema';
import { GuestGroup } from '../schemas/invitation-guest.schema';
import {
  CARD_COLOUR_IDS,
  HERO_VIDEO_MAX_SECONDS,
  HeroMediaType,
  INVITATION_FONTS,
  INVITATION_TEMPLATES,
  NOTIFICATION_MESSAGE_MAX,
  STORY_CAPTION_MAX,
  STORY_MAX_CARDS,
  STORY_TITLE_MAX,
  WELCOME_MESSAGE_MAX,
  LIVE_TITLE_MAX,
} from '../invitation-defaults';

const TEMPLATE_IDS = INVITATION_TEMPLATES.map((t) => t.id);
const FONT_IDS = INVITATION_FONTS.map((f) => f.id);
const HERO_MEDIA_TYPES = Object.values(HeroMediaType);
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

  /**
   * The welcome message on the cover.
   *
   * 200 characters, checked here as well as in the editor: the editor's
   * counter is a courtesy to the organizer, not a control — a request that
   * skips it is rejected the same way.
   */
  @IsOptional()
  @IsString()
  @MaxLength(WELCOME_MESSAGE_MAX)
  message?: string;

  /* ---- the cover block's own configuration ---- */

  /** One of INVITATION_FONTS. A family name from the client is refused. */
  @IsOptional()
  @IsIn(FONT_IDS)
  fontStyle?: string;

  @IsOptional()
  @IsIn(HERO_MEDIA_TYPES)
  heroMediaType?: HeroMediaType;

  /**
   * The url the upload endpoint returned for this media.
   *
   * Bounded and typed, but deliberately not a URL-format check: the upload
   * driver may return an absolute url or a path under this API depending on
   * how storage is configured, and both are legitimate.
   */
  @IsOptional()
  @IsString()
  @MaxLength(600)
  heroMediaUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  heroMediaKey?: string;

  /** A cover video is a moment, not a film. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(HERO_VIDEO_MAX_SECONDS)
  heroMediaDurationSec?: number;

  /** What the story section is called. */
  @IsOptional()
  @IsString()
  @MaxLength(STORY_TITLE_MAX)
  storyTitle?: string;

  /* ---- the countdown, and the notice it raises ---- */

  /**
   * Which sub-event the countdown points at. '' means the invitation's date.
   *
   * Shape-checked here; that it is *this invitation's* sub-event is checked in
   * the service, which is the only place that knows.
   */
  @IsOptional()
  @Matches(/^$|^[0-9a-fA-F]{24}$/, { message: 'countdownSubEventId must be an id' })
  countdownSubEventId?: string;

  @IsOptional()
  @IsBoolean()
  oneDayNotificationEnabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(NOTIFICATION_MESSAGE_MAX)
  oneDayNotificationMessage?: string;

  @IsOptional()
  @IsString()
  @MaxLength(NOTIFICATION_MESSAGE_MAX)
  missedNotificationMessage?: string;

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
  /**
   * The card's existing id, echoed back so an edit keeps its identity.
   *
   * Empty (or absent) for a card being added. It is not trusted as an id: the
   * service only honours one that already belongs to this invitation, so a
   * client cannot mint an id or graft another event's card onto this one.
   */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  id?: string;

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

  /**
   * Which guest groups a targeted card is for.
   *
   * Only read when `visibility` is `groups`; the service drops it otherwise,
   * so a card switched back to "everyone" cannot keep a stale rule.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @IsEnum(GuestGroup, { each: true })
  groups?: GuestGroup[];

  /* ---- F5: this event's live stream -------------------------------------- */

  @IsOptional()
  @IsBoolean()
  liveEnabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(LIVE_TITLE_MAX)
  liveTitle?: string;

  /**
   * The embed url, and its two optional alternates.
   *
   * `IsEmbeddableStreamUrl` and not `@IsUrl()`: this value becomes the `src`
   * of an iframe in a guest's browser, so the question is not whether it is a
   * well-formed url but whether it is a player we are willing to run. Empty
   * is allowed — it is how a stream is cleared.
   */
  @IsOptional()
  @IsEmbeddableStreamUrl()
  liveUrl?: string;

  @IsOptional()
  @IsEmbeddableStreamUrl()
  live360Url?: string;

  @IsOptional()
  @IsEmbeddableStreamUrl()
  liveVrUrl?: string;
}

/**
 * Partial update of one invitation. `blocks` and `subEvents`, when present,
 * each replace the whole list — the builder reorders, adds and hides them, so a
 * full replacement is both simpler and race-free compared with per-item
 * patches. Array order is the display order.
 */
/**
 * One story card on the way in.
 *
 * `imageUrl` is required because a card is a photograph — a caption with no
 * picture is not a story card, and storing one would put an empty frame in the
 * middle of somebody's invitation. Videos have no representation here at all,
 * which is how they are kept out.
 */
export class InvitationStoryCardDto {
  @IsString()
  @MaxLength(600)
  imageUrl: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  imageKey?: string;

  /*
   * Trimmed before it is measured, so trailing spaces cannot push a caption
   * over the limit — and never truncated: a caption that is too long is the
   * organizer's to shorten, not ours to cut mid-word.
   */
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MaxLength(STORY_CAPTION_MAX)
  caption?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;
}

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

  /**
   * The whole story, replacing whatever was stored.
   *
   * One array rather than add/update/delete/reorder routes: every one of those
   * operations is this array with one element added, changed, removed or moved,
   * and four endpoints that each rebuild the same list are four chances for the
   * order to disagree with itself. It is how `subEvents` already works.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(STORY_MAX_CARDS)
  @ValidateNested({ each: true })
  @Type(() => InvitationStoryCardDto)
  storyCards?: InvitationStoryCardDto[];
}
