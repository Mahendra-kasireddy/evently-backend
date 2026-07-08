import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { QuoteService } from './quote.service';
import { QuoteController } from './quote.controller';
import { QuoteRequest, QuoteRequestSchema } from './schemas/quote-request.schema';
import { Quotation, QuotationSchema } from './schemas/quotation.schema';
import { OrganizerModule } from '../organizer/organizer.module';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: QuoteRequest.name, schema: QuoteRequestSchema },
      { name: Quotation.name, schema: QuotationSchema },
    ]),
    OrganizerModule,
    NotificationModule,
  ],
  controllers: [QuoteController],
  providers: [QuoteService],
  exports: [QuoteService],
})
export class QuoteModule {}
