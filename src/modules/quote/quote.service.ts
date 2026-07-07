import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { QuoteRequest, QuoteRequestDocument } from './schemas/quote-request.schema';
import { RequestQuotesDto } from './dto/request-quotes.dto';
import { RequestQuoteFromOrganizerDto } from './dto/request-quote-from-organizer.dto';

@Injectable()
export class QuoteService {
  constructor(
    @InjectModel(QuoteRequest.name)
    private readonly quoteModel: Model<QuoteRequestDocument>,
  ) {}

  /** Open request from the hero draft, broadcast to matched organizers. */
  createFromDraft(userId: string, dto: RequestQuotesDto): Promise<QuoteRequestDocument> {
    return this.quoteModel.create({
      customer: new Types.ObjectId(userId),
      organizer: null,
      occasion: dto.occasion,
      when: dto.when ?? '',
      where: dto.where ?? '',
      guests: dto.guests ?? '',
    });
  }

  /** Request targeted at a single organizer ("Get quote" on a card). */
  createForOrganizer(
    userId: string,
    dto: RequestQuoteFromOrganizerDto,
  ): Promise<QuoteRequestDocument> {
    return this.quoteModel.create({
      customer: new Types.ObjectId(userId),
      organizer: new Types.ObjectId(dto.organizerId),
      occasion: dto.occasion,
      when: dto.when ?? '',
      where: dto.where ?? '',
      guests: dto.guests ?? '',
    });
  }

  /** The user's quote requests, newest first (for the /quotes screen). */
  listForUser(userId: string): Promise<QuoteRequestDocument[]> {
    return this.quoteModel
      .find({ customer: userId })
      .populate('organizer', 'name initials avatarColor tier rating')
      .sort({ createdAt: -1 })
      .exec();
  }
}
