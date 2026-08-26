import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { ShareGuestDto } from './add-guest.dto';

/**
 * One share request, serving both "share this section" and "share the complete
 * invitation" — the only difference is whether `section` is set.
 *
 * Guests arrive either as ids already on the list or as new entries typed into
 * the dialog, and both in the same request: the customer should be able to pick
 * three known guests, add a fourth, and press send once.
 */
export class ShareInvitationDto {
  /**
   * A block key from the published invitation, or absent for the whole thing.
   * Never an invitation id — there is exactly one invitation per booking.
   */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  section?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  guestIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ShareGuestDto)
  newGuests?: ShareGuestDto[];
}
