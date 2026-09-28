import { IsEnum, IsOptional } from 'class-validator';
import { NotificationKind } from '../invitation-defaults';

/**
 * Which notice a guest is dismissing.
 *
 * The only thing a guest's client gets to say, and it is a choice between the
 * notices they could have been shown — never an id. Absent means the
 * day-before notice, which is what the route meant before the live one
 * existed, so an older client keeps working unchanged.
 */
export class DismissNotificationDto {
  @IsOptional()
  @IsEnum(NotificationKind)
  kind?: NotificationKind;
}
