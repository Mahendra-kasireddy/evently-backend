import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AcademyProgress, AcademyProgressDocument } from './schemas/academy-progress.schema';
import { OrganizerService } from './organizer.service';
import { STAGE1_LESSONS, STAGE2_WORKSHOPS, STAGE3_ITEMS } from './academy-content';

@Injectable()
export class AcademyService {
  constructor(
    @InjectModel(AcademyProgress.name)
    private readonly progressModel: Model<AcademyProgressDocument>,
    private readonly organizerService: OrganizerService,
  ) {}

  private async organizerId(userId: string): Promise<Types.ObjectId> {
    const profile = await this.organizerService.findByUser(userId);
    if (!profile) throw new ForbiddenException('No organizer profile is linked to your account');
    return profile._id;
  }

  private async loadOrCreate(organizerId: Types.ObjectId): Promise<AcademyProgressDocument> {
    const existing = await this.progressModel.findOne({ organizer: organizerId }).exec();
    if (existing) return existing;
    return this.progressModel.create({ organizer: organizerId });
  }

  /** Recomputes trainingStage from real progress and persists it on the profile. */
  private async syncTrainingStage(
    organizerId: Types.ObjectId,
    progress: AcademyProgressDocument,
  ): Promise<number> {
    let stage = 0;
    if (STAGE1_LESSONS.every((l) => progress.completedLessons.includes(l.key))) stage = 1;
    if (stage === 1 && STAGE2_WORKSHOPS.every((w) => progress.registeredWorkshops.includes(w.key)))
      stage = 2;
    if (stage === 2 && STAGE3_ITEMS.every((i) => progress.completedStage3.includes(i.key)))
      stage = 3;

    const profile = await this.organizerService.findById(organizerId.toString());
    if (profile.trainingStage !== stage) {
      profile.trainingStage = stage;
      await profile.save();
    }
    return stage;
  }

  async getStatus(userId: string): Promise<Record<string, unknown>> {
    const organizerId = await this.organizerId(userId);
    const progress = await this.loadOrCreate(organizerId);
    const trainingStage = await this.syncTrainingStage(organizerId, progress);

    const stage1Done = STAGE1_LESSONS.filter((l) =>
      progress.completedLessons.includes(l.key),
    ).length;

    return {
      trainingStage,
      overallPercent: Math.round((trainingStage / 3) * 100),
      stage1: {
        completedCount: stage1Done,
        totalCount: STAGE1_LESSONS.length,
        lessons: STAGE1_LESSONS.map((l) => ({
          ...l,
          completed: progress.completedLessons.includes(l.key),
        })),
      },
      stage2: {
        unlocked: trainingStage >= 1,
        workshops: STAGE2_WORKSHOPS.map((w) => ({
          ...w,
          registered: progress.registeredWorkshops.includes(w.key),
        })),
      },
      stage3: {
        unlocked: trainingStage >= 2,
        items: STAGE3_ITEMS.map((i) => ({
          ...i,
          completed: progress.completedStage3.includes(i.key),
        })),
      },
    };
  }

  async completeLesson(userId: string, key: string): Promise<Record<string, unknown>> {
    if (!STAGE1_LESSONS.some((l) => l.key === key)) throw new NotFoundException('Unknown lesson');
    const organizerId = await this.organizerId(userId);
    const progress = await this.loadOrCreate(organizerId);
    if (!progress.completedLessons.includes(key)) {
      progress.completedLessons.push(key);
      await progress.save();
    }
    await this.syncTrainingStage(organizerId, progress);
    return this.getStatus(userId);
  }

  async registerWorkshop(userId: string, key: string): Promise<Record<string, unknown>> {
    if (!STAGE2_WORKSHOPS.some((w) => w.key === key))
      throw new NotFoundException('Unknown workshop');
    const organizerId = await this.organizerId(userId);
    const progress = await this.loadOrCreate(organizerId);
    if (!progress.registeredWorkshops.includes(key)) {
      progress.registeredWorkshops.push(key);
      await progress.save();
    }
    await this.syncTrainingStage(organizerId, progress);
    return this.getStatus(userId);
  }

  async completeStage3(userId: string, key: string): Promise<Record<string, unknown>> {
    if (!STAGE3_ITEMS.some((i) => i.key === key)) throw new NotFoundException('Unknown item');
    const organizerId = await this.organizerId(userId);
    const progress = await this.loadOrCreate(organizerId);
    if (!progress.completedStage3.includes(key)) {
      progress.completedStage3.push(key);
      await progress.save();
    }
    await this.syncTrainingStage(organizerId, progress);
    return this.getStatus(userId);
  }
}
