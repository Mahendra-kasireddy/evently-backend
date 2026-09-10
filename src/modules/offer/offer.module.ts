import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { OfferService } from './offer.service';
import { OfferController } from './offer.controller';
import { AdminOfferController } from './admin-offer.controller';
import { Offer, OfferSchema } from './schemas/offer.schema';

@Module({
  imports: [MongooseModule.forFeature([{ name: Offer.name, schema: OfferSchema }])],
  controllers: [OfferController, AdminOfferController],
  providers: [OfferService],
  exports: [OfferService],
})
export class OfferModule {}
