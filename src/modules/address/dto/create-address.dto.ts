import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { AddressLabel } from '../schemas/address.schema';

/**
 * The pin, in the order a human reads it.
 *
 * The schema stores GeoJSON, which is [longitude, latitude] — the reverse. The
 * flip happens once, in the service, rather than being asked of every caller:
 * a latitude in a longitude's slot is silently valid to Mongo and lands the
 * address in the wrong hemisphere, so the boundary is the right place to stop
 * it and named fields are what make it impossible to get wrong.
 */
export class CoordinatesDto {
  @IsLatitude()
  latitude: number;

  @IsLongitude()
  longitude: number;
}

export class CreateAddressDto {
  @IsOptional()
  @IsEnum(AddressLabel)
  label?: AddressLabel;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  customLabel?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  houseNumber: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  building?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  landmark?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(400)
  formattedAddress: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  area?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  state?: string;

  @IsOptional()
  @IsString()
  @MaxLength(12)
  pincode?: string;

  @ValidateNested()
  @Type(() => CoordinatesDto)
  coordinates: CoordinatesDto;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  receiverName: string;

  /*
   * Digits, with an optional leading +, 7 to 15 of them.
   *
   * Deliberately not a strict Indian-mobile pattern. This number exists so an
   * organizer can ring the door; a customer whose contact is a landline, or a
   * number abroad, is not making a mistake, and a validator that rejects them
   * costs a real booking to prevent a typo the organizer would notice anyway.
   */
  @IsString()
  @Matches(/^\+?[0-9]{7,15}$/, {
    message: 'receiverPhone must be 7 to 15 digits, optionally starting with +',
  })
  receiverPhone: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
