import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AddressService } from './address.service';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';
import { ListAddressQueryDto } from './dto/list-address-query.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Role } from '../../common/enums/role.enum';

/** The customer's saved delivery addresses. */
@UseGuards(RolesGuard)
@Roles(Role.CUSTOMER, Role.ADMIN)
@Controller('address')
export class AddressController {
  constructor(private readonly addressService: AddressService) {}

  /**
   * Every saved address.
   *
   * `lat` and `lng` are optional and describe where the customer is asking
   * from; supplying them sorts the list nearest-first and puts a distance on
   * each entry.
   */
  @Get()
  list(@CurrentUser('userId') userId: string, @Query() query: ListAddressQueryDto) {
    const near =
      query.lat !== undefined && query.lng !== undefined
        ? { latitude: query.lat, longitude: query.lng }
        : undefined;

    return this.addressService.listForUser(userId, near);
  }

  @Post()
  create(@CurrentUser('userId') userId: string, @Body() dto: CreateAddressDto) {
    return this.addressService.create(userId, dto);
  }

  @Patch(':addressId')
  update(
    @CurrentUser('userId') userId: string,
    @Param('addressId') addressId: string,
    @Body() dto: UpdateAddressDto,
  ) {
    return this.addressService.update(userId, addressId, dto);
  }

  @Delete(':addressId')
  remove(@CurrentUser('userId') userId: string, @Param('addressId') addressId: string) {
    return this.addressService.remove(userId, addressId);
  }

  /** Its own route rather than a PATCH, because it changes two documents. */
  @HttpCode(HttpStatus.OK)
  @Post(':addressId/default')
  setDefault(@CurrentUser('userId') userId: string, @Param('addressId') addressId: string) {
    return this.addressService.setDefault(userId, addressId);
  }
}
