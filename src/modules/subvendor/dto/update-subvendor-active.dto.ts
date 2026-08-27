import { IsBoolean } from 'class-validator';

/** Take a sub-vendor off the roster, or put them back on it. */
export class UpdateSubVendorActiveDto {
  @IsBoolean({ message: 'active must be true or false' })
  active: boolean;
}
