import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { GuestGroup } from '../schemas/invitation-guest.schema';

/**
 * A guest the customer is adding.
 *
 * The phone is validated as a plain string here and parsed in the service
 * rather than by a decorator, because the parse is not a yes/no: it normalises
 * many spellings to one E.164 key, and that key is what the duplicate rule and
 * the WhatsApp send both need. A `@Matches` would answer only half the question.
 */
export class AddGuestDto {
  @IsString()
  @MinLength(1, { message: 'Enter the guest’s name.' })
  @MaxLength(80)
  name: string;

  @IsString()
  @MaxLength(24)
  phone: string;

  /** Absent from an older client, and from a contact with nothing to say. */
  @IsOptional()
  @IsEnum(GuestGroup)
  group?: GuestGroup;
}

/**
 * Editing a guest already on the list.
 *
 * Every field optional and applied only when present, so changing somebody's
 * group does not require the caller to resend a name and number it never
 * showed the customer.
 */
export class UpdateGuestDto {
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'Enter the guest’s name.' })
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(24)
  phone?: string;

  @IsOptional()
  @IsEnum(GuestGroup)
  group?: GuestGroup;
}

/**
 * Several guests at once — what a phonebook import sends.
 *
 * Bounded because each entry is a document write and a duplicate check.
 * Importing a whole address book in one request is how a list of four hundred
 * arrives, which is not a guest list anybody sends invitations to.
 */
export class AddGuestsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => AddGuestDto)
  guests: AddGuestDto[];
}

/** One guest inside a share request, added inline from the dialog. */
export class ShareGuestDto {
  @IsString()
  @MinLength(1, { message: 'Enter the guest’s name.' })
  @MaxLength(80)
  name: string;

  @IsString()
  @MaxLength(24)
  phone: string;

  @IsOptional()
  @IsString()
  note?: string;
}
