import { IsEnum } from 'class-validator';
import { UserStatus } from '../schemas/user.schema';

/** Suspend or reactivate one account. */
export class UpdateUserStatusDto {
  @IsEnum(UserStatus, { message: 'Unknown account status' })
  status: UserStatus;
}
