import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * What a customer may ask of the catalogue.
 *
 * Note what is absent: any way to name a status. The catalogue decides for
 * itself which events are visible, and a client that could ask for drafts is a
 * client that could read an organizer's unfinished work.
 */
export class BrowsePublicEventsDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  category?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  city?: string;

  /** With a radius, these turn the list into "near me". */
  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  lat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  lng?: number;

  /** Kilometres. Clamped server-side, so a huge number is not a full scan. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(500)
  radiusKm?: number;

  @IsOptional()
  @IsEnum(['soon', 'price', 'new'])
  sort?: 'soon' | 'price' | 'new';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  page?: number;
}

/**
 * Start a ticket purchase.
 *
 * A ticket type and a count. Deliberately no price and no total: both are read
 * from the ticket type on the server, so what the checkout screen displayed can
 * never be what the customer is charged.
 */
export class StartEventBookingDto {
  @IsMongoId()
  ticketTypeId: string;

  @IsInt()
  @Min(1)
  @Max(50)
  quantity: number;
}

/** What Razorpay's checkout hands back. The signature is what matters. */
export class ConfirmEventBookingDto {
  @IsString()
  @MaxLength(120)
  razorpayOrderId: string;

  @IsString()
  @MaxLength(120)
  razorpayPaymentId: string;

  @IsString()
  @MaxLength(256)
  razorpaySignature: string;
}

export class ListMyTicketsDto {
  @IsOptional()
  @IsEnum(['upcoming', 'checked_in', 'completed', 'cancelled'])
  status?: 'upcoming' | 'checked_in' | 'completed' | 'cancelled';

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

/** Which memories to list: everything, or only photos or only clips. */
export class ListEventMemoriesDto {
  @IsOptional()
  @IsEnum(['photo', 'video'])
  kind?: 'photo' | 'video';
}

/** The optional words sent alongside an uploaded memory. */
export class AddEventMemoryDto {
  @IsOptional()
  @IsString()
  @MaxLength(280)
  caption?: string;
}
