import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * What a sender may set.
 *
 * Only the text. The conversation comes from the route, the sender's role and
 * account from the session — accepting either from the body would let anyone
 * post into any thread as anybody.
 */
export class SendMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  text: string;
}
