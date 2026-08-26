import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

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
