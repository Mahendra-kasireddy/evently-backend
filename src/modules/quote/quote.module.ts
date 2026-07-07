import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { QuoteService } from './quote.service';
import { QuoteController } from './quote.controller';
import { QuoteRequest, QuoteRequestSchema } from './schemas/quote-request.schema';

@Module({
  imports: [MongooseModule.forFeature([{ name: QuoteRequest.name, schema: QuoteRequestSchema }])],
  controllers: [QuoteController],
  providers: [QuoteService],
  exports: [QuoteService],
})
export class QuoteModule {}
