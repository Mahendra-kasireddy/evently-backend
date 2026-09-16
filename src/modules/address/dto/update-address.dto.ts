import { PartialType } from '@nestjs/mapped-types';
import { CreateAddressDto } from './create-address.dto';

/**
 * Everything a create takes, all of it optional.
 *
 * Edit Location is the same form as Add Address Details, and a customer
 * correcting a floor number should not have to resend the pin. PartialType is
 * the project's existing way of saying that (`@nestjs/mapped-types` is already
 * a dependency), so the validation rules stay written once.
 */
export class UpdateAddressDto extends PartialType(CreateAddressDto) {}
