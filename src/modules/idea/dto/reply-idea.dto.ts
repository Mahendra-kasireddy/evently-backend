import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { IdeaPlanStatus } from '../schemas/booking-idea.schema';

/** The organizer turning an idea into a plan, optionally asking for sign-off. */
export class ReplyIdeaDto {
  @IsEnum(IdeaPlanStatus)
  status: IdeaPlanStatus;

  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  text: string;

  /**
   * Present when the reply needs the customer to approve something. The text is
   * what they are being asked to agree to, so it is required to be meaningful
   * rather than a bare flag.
   */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(400)
  approvalLabel?: string;
}
