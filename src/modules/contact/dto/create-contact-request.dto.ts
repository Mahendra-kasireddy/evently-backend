import { Transform } from 'class-transformer';
import { IsEmail, IsEnum, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { ContactSubject } from '../schemas/contact-request.schema';

/** Strips surrounding whitespace before validation, so " " is not a name. */
const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * A support request from the Contact Us form.
 *
 * There is deliberately no `userId` field: the owning user is taken from the
 * access token when one is present, never from the body, so a caller cannot
 * file a request in somebody else's name.
 */
export class CreateContactRequestDto {
  @Transform(trim)
  @IsString()
  @MinLength(2, { message: 'Please enter your name' })
  @MaxLength(80)
  name: string;

  @Transform(trim)
  @IsEmail({}, { message: 'Enter a valid email address' })
  @MaxLength(160)
  email: string;

  /**
   * 10-digit Indian mobile — the same rule the OTP login enforces, so a
   * customer is not asked for their number in two different formats.
   */
  @Transform(({ value }) => (typeof value === 'string' ? value.replace(/[\s-]/g, '') : value))
  @IsString()
  @Matches(/^\d{10}$/, { message: 'Enter a valid 10-digit mobile number' })
  phone: string;

  @IsEnum(ContactSubject, { message: 'Choose what your message is about' })
  subject: ContactSubject;

  @Transform(trim)
  @IsString()
  @MinLength(10, { message: 'Please tell us a little more — at least 10 characters' })
  @MaxLength(5000)
  message: string;
}
