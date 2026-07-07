import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';

import { Event, EventDocument } from './schemas/event.schema';
import { CreatePlanEventDto } from './dto/create-plan-event.dto';
import { UpdatePlanEventDto } from './dto/update-plan-event.dto';
import { QueryPlanEventDto } from './dto/query-plan-event.dto';
import { PaginatedResult } from '../../common/dto/pagination.dto';
import { Role } from '../../common/enums/role.enum';
import { AuthUser } from '../../common/decorators/current-user.decorator';

@Injectable()
export class PlanEventService {
  constructor(@InjectModel(Event.name) private readonly eventModel: Model<EventDocument>) {}

  async create(organizerId: string, dto: CreatePlanEventDto): Promise<EventDocument> {
    if (dto.endAt <= dto.startAt) {
      throw new BadRequestException('endAt must be after startAt');
    }
    const event = new this.eventModel({ ...dto, organizer: new Types.ObjectId(organizerId) });
    return event.save();
  }

  async findAll(query: QueryPlanEventDto): Promise<PaginatedResult<EventDocument>> {
    const filter: FilterQuery<EventDocument> = {};
    if (query.status) filter.status = query.status;
    if (query.category) filter.category = query.category;
    if (query.q) filter.title = { $regex: query.q, $options: 'i' };

    const [data, total] = await Promise.all([
      this.eventModel.find(filter).sort({ startAt: 1 }).skip(query.skip).limit(query.limit).exec(),
      this.eventModel.countDocuments(filter).exec(),
    ]);

    return {
      data,
      meta: {
        total,
        page: query.page,
        limit: query.limit,
        pages: Math.ceil(total / query.limit),
      },
    };
  }

  async findOne(id: string): Promise<EventDocument> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Event not found');
    const event = await this.eventModel.findById(id).exec();
    if (!event) throw new NotFoundException('Event not found');
    return event;
  }

  async update(id: string, dto: UpdatePlanEventDto, actor: AuthUser): Promise<EventDocument> {
    const event = await this.findOne(id);
    this.assertCanManage(event, actor);

    const start = dto.startAt ?? event.startAt;
    const end = dto.endAt ?? event.endAt;
    if (end <= start) {
      throw new BadRequestException('endAt must be after startAt');
    }

    Object.assign(event, dto);
    return event.save();
  }

  async remove(id: string, actor: AuthUser): Promise<void> {
    const event = await this.findOne(id);
    this.assertCanManage(event, actor);
    await event.deleteOne();
  }

  /** Owner organizer or any admin may manage an event. */
  private assertCanManage(event: EventDocument, actor: AuthUser): void {
    const isOwner = event.organizer.toString() === actor.userId;
    const isAdmin = actor.roles?.includes(Role.ADMIN);
    if (!isOwner && !isAdmin) {
      throw new ForbiddenException('You do not own this event');
    }
  }
}
