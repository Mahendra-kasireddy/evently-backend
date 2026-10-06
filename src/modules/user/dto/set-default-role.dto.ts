import { IsIn } from 'class-validator';
import { Role } from '../../../common/enums/role.enum';

/** The sides of the product an account can open on. Admin is not one of them. */
export const DEFAULT_ROLE_CHOICES = [Role.CUSTOMER, Role.ORGANIZER, Role.VENDOR] as const;

export class SetDefaultRoleDto {
  @IsIn(DEFAULT_ROLE_CHOICES)
  role: Role;
}
