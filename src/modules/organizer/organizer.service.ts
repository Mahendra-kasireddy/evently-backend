import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { OrganizerProfile, OrganizerProfileDocument } from './schemas/organizer-profile.schema';

@Injectable()
export class OrganizerService {
  constructor(
    @InjectModel(OrganizerProfile.name)
    private readonly organizerModel: Model<OrganizerProfileDocument>,
  ) {}

  /** Top-ranked active organizers for the home "near you" section. */
  findTop(limit = 6): Promise<OrganizerProfileDocument[]> {
    return this.organizerModel
      .find({ active: true })
      .sort({ rank: -1, rating: -1 })
      .limit(limit)
      .exec();
  }

  /** All active organizers (for the plan "find organizers" step). */
  findAllActive(): Promise<OrganizerProfileDocument[]> {
    return this.organizerModel.find({ active: true }).sort({ rating: -1 }).exec();
  }

  async findById(id: string): Promise<OrganizerProfileDocument> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Organizer not found');
    const organizer = await this.organizerModel.findById(id).exec();
    if (!organizer) throw new NotFoundException('Organizer not found');
    return organizer;
  }

  /** The organizer profile owned by a given user account (null if none). */
  findByUser(userId: string): Promise<OrganizerProfileDocument | null> {
    if (!Types.ObjectId.isValid(userId)) return Promise.resolve(null);
    return this.organizerModel.findOne({ user: new Types.ObjectId(userId) }).exec();
  }
}
