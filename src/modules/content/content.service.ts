import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Content, ContentDocument } from './schemas/content.schema';

export const CUSTOMER_HOME_KEY = 'customer-home';

@Injectable()
export class ContentService {
  constructor(@InjectModel(Content.name) private readonly contentModel: Model<ContentDocument>) {}

  /** Returns the editable copy blob for a content key. */
  async getData(key: string): Promise<Record<string, unknown>> {
    const doc = await this.contentModel.findOne({ key }).exec();
    if (!doc) {
      throw new NotFoundException(`Content "${key}" not found — run the seed.`);
    }
    return doc.data;
  }
}
