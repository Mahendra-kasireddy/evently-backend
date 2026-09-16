import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AddressService } from './address.service';
import { AddressController } from './address.controller';
import { Address, AddressSchema } from './schemas/address.schema';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Address.name, schema: AddressSchema }]),
    AuthModule,
  ],
  controllers: [AddressController],
  providers: [AddressService],
  /* Exported so booking and checkout can read the default address without
     reaching for the collection themselves. */
  exports: [AddressService],
})
export class AddressModule {}
