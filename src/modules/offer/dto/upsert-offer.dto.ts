import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { OfferTone } from '../schemas/offer.schema';

/**
 * What an admin may set on an offer.
 *
 * Every field an offer has is here, because an admin owns all of them — unlike
 * the customer-facing DTOs elsewhere in this codebase, where omitting a field
 * is the access control. What keeps this safe is the route: the controller
 * carrying it is `@Roles(Role.ADMIN)` behind `RolesGuard`, so nothing reaches
 * this DTO without an admin session.
 */
export class UpsertOfferDto {
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  eyebrow: string;

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  terms?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  ctaLabel?: string;

  @IsOptional()
  @IsEnum(OfferTone)
  tone?: OfferTone;

  /** ISO 8601, or omitted for "live already". */
  @IsOptional()
  @IsISO8601()
  startsAt?: string;

  /** ISO 8601, or omitted for "does not expire". */
  @IsOptional()
  @IsISO8601()
  endsAt?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
