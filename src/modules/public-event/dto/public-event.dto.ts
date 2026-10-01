import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  CANCEL_REASON_MAX,
  EVENT_ADDRESS_MAX,
  EVENT_CAPACITY_MAX,
  EVENT_CATEGORY_MAX,
  EVENT_CITY_MAX,
  EVENT_CONTACT_MAX,
  EVENT_DESCRIPTION_MAX,
  EVENT_TIMEZONE_MAX,
  EVENT_TITLE_MAX,
  EVENT_VENUE_MAX,
  PublicEventStatus,
} from '../public-event.constants';

/**
 * Every field a client may send about an event's venue.
 *
 * Nothing here is trusted beyond its shape: the pipe runs with
 * `whitelist: true`, so a property that is not declared is dropped silently —
 * which is why a field added to a schema and forgotten here saves nothing and
 * reports no error.
 */
export class EventVenueDto {
  @IsOptional()
  @IsString()
  @MaxLength(EVENT_VENUE_MAX)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(EVENT_ADDRESS_MAX)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(EVENT_CITY_MAX)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(EVENT_CITY_MAX)
  state?: string;

  @IsOptional()
  @IsLatitude()
  latitude?: number;

  @IsOptional()
  @IsLongitude()
  longitude?: number;
}

export class CreatePublicEventDto {
  @IsString()
  @MinLength(3)
  @MaxLength(EVENT_TITLE_MAX)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(EVENT_CATEGORY_MAX)
  category?: string;

  @IsOptional()
  @IsString()
  @MaxLength(EVENT_DESCRIPTION_MAX)
  description?: string;

  /**
   * The cover, as the shared upload endpoint returned it.
   *
   * A URL, not a file: the image goes through the one upload service every
   * other module uses, and this records where it landed. The storage key is
   * deliberately absent — the server derives it, so a client cannot point an
   * event's cover at a key it was never given.
   */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  coverUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(EVENT_CONTACT_MAX)
  contactName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(EVENT_CONTACT_MAX)
  contactPhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(EVENT_CONTACT_MAX)
  contactEmail?: string;

  @IsISO8601()
  startDateTime: string;

  @IsOptional()
  @IsISO8601()
  endDateTime?: string;

  @IsOptional()
  @IsString()
  @MaxLength(EVENT_TIMEZONE_MAX)
  timezone?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => EventVenueDto)
  venue?: EventVenueDto;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(EVENT_CAPACITY_MAX)
  capacity?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  maxPerCustomer?: number;
}

/** Everything on create, all optional. Status is moved by its own routes. */
export class UpdatePublicEventDto extends CreatePublicEventDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(EVENT_TITLE_MAX)
  declare title: string;

  @IsOptional()
  @IsISO8601()
  declare startDateTime: string;
}

/**
 * A status move, asked for by name.
 *
 * The server still decides whether it is allowed: the transition table is the
 * authority, not this field. SOLD_OUT is absent on purpose — it is what the
 * remaining stock says, not something an organizer declares.
 */
export class ChangeEventStatusDto {
  @IsEnum([
    PublicEventStatus.DRAFT,
    PublicEventStatus.PUBLISHED,
    PublicEventStatus.COMPLETED,
    PublicEventStatus.CANCELLED,
  ])
  status: PublicEventStatus;

  @IsOptional()
  @IsString()
  @MaxLength(CANCEL_REASON_MAX)
  reason?: string;
}

export class ListPublicEventsDto {
  @IsOptional()
  @IsEnum(PublicEventStatus)
  status?: PublicEventStatus;

  @IsOptional()
  @IsString()
  @MaxLength(EVENT_TITLE_MAX)
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  page?: number;
}

/** Numbers are not booleans, and a checkbox is not a date. */
export class EventMemoriesSettingsDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsEnum(['checked_in', 'ticket_holders', 'nobody'])
  uploaders?: 'checked_in' | 'ticket_holders' | 'nobody';

  @IsOptional()
  @IsBoolean()
  attendeeView?: boolean;

  @IsOptional()
  @IsBoolean()
  attendeeDownload?: boolean;

  @IsOptional()
  @IsBoolean()
  moderation?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  uploadWindowDays?: number;
}

export class EventLiveStreamSettingsDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsEnum(['free', 'ticketed'])
  access?: 'free' | 'ticketed';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  url?: string;

  @IsOptional()
  @IsISO8601()
  startsAt?: string;

  @IsOptional()
  @IsISO8601()
  endsAt?: string;

  @IsOptional()
  @IsBoolean()
  replayEnabled?: boolean;
}

/** What a scanner sends. One of the two, never both trusted at once. */
export class CheckInDto {
  @IsOptional()
  @IsString()
  @MaxLength(400)
  qrToken?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  code?: string;
}

export class ListAttendeesDto {
  @IsOptional()
  @IsEnum(['all', 'checked_in', 'pending'])
  checkIn?: 'all' | 'checked_in' | 'pending';

  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  page?: number;
}

export class TicketTypeDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsNumber()
  @Min(0)
  @Max(10_000_000)
  price: number;

  @IsInt()
  @Min(0)
  @Max(1_000_000)
  totalQuantity: number;

  @IsOptional()
  @IsISO8601()
  salesStart?: string;

  @IsOptional()
  @IsISO8601()
  salesEnd?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(50)
  maxPerCustomer?: number;

  @IsOptional()
  @IsEnum(['active', 'paused'])
  status?: 'active' | 'paused';
}

export class UpdateTicketTypeDto extends TicketTypeDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  declare name: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10_000_000)
  declare price: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  declare totalQuantity: number;
}
