import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import {
  PlanStatus,
  PlanSubmission,
  PlanSubmissionDocument,
} from './schemas/plan-submission.schema';
import { UpsertPlanDto } from './dto/upsert-plan.dto';
import { NotificationService } from '../notification/notification.service';
import { NotificationType } from '../notification/schemas/notification.schema';

/**
 * Persistence for customer event plans: a single resumable draft per customer,
 * promotion to a submitted plan, and owner-scoped read/update/delete.
 */
@Injectable()
export class PlanSubmissionService {
  private readonly logger = new Logger(PlanSubmissionService.name);

  constructor(
    @InjectModel(PlanSubmission.name)
    private readonly planModel: Model<PlanSubmissionDocument>,
    private readonly notificationService: NotificationService,
  ) {}

  /**
   * Fire a "plan submitted" notification to the customer. Best-effort: a failed
   * notification must never roll back a successfully persisted plan.
   */
  private async notifySubmitted(userId: string, plan: PlanSubmissionDocument): Promise<void> {
    try {
      await this.notificationService.create(
        userId,
        'Your event plan is in',
        `We've sent your ${plan.occasion || 'event'} plan (${plan.planCode}) to matched organizers. Tailored quotes arrive within a day.`,
        NotificationType.SYSTEM,
        '/workspace',
      );
    } catch (err) {
      this.logger.warn(`Failed to emit plan-submitted notification: ${String(err)}`);
    }
  }

  private static generatePlanCode(): string {
    return `PLN-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  }

  private toObjectId(userId: string): Types.ObjectId {
    return new Types.ObjectId(userId);
  }

  /** Upserts the customer's single live draft (used for silent autosave/resume). */
  async saveDraft(userId: string, dto: UpsertPlanDto): Promise<PlanSubmissionDocument> {
    const customer = this.toObjectId(userId);
    return this.planModel
      .findOneAndUpdate(
        { customer, status: PlanStatus.DRAFT },
        { $set: { ...dto, customer, status: PlanStatus.DRAFT } },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      )
      .exec();
  }

  /** The customer's current draft, or null if none. */
  getMyDraft(userId: string): Promise<PlanSubmissionDocument | null> {
    return this.planModel
      .findOne({ customer: this.toObjectId(userId), status: PlanStatus.DRAFT })
      .exec();
  }

  /**
   * Submits a plan: promotes the live draft (if any) to SUBMITTED with a plan
   * code, otherwise creates a fresh submitted plan.
   */
  async submit(userId: string, dto: UpsertPlanDto): Promise<PlanSubmissionDocument> {
    const customer = this.toObjectId(userId);
    const draft = await this.planModel.findOne({ customer, status: PlanStatus.DRAFT }).exec();

    if (draft) {
      Object.assign(draft, dto, {
        status: PlanStatus.SUBMITTED,
        planCode: draft.planCode ?? PlanSubmissionService.generatePlanCode(),
      });
      const saved = await draft.save();
      await this.notifySubmitted(userId, saved);
      return saved;
    }

    const created = await this.planModel.create({
      ...dto,
      occasion: dto.occasion ?? '',
      customer,
      status: PlanStatus.SUBMITTED,
      planCode: PlanSubmissionService.generatePlanCode(),
    });
    await this.notifySubmitted(userId, created);
    return created;
  }

  /** All plans owned by the customer, most recently updated first. */
  findMine(userId: string): Promise<PlanSubmissionDocument[]> {
    return this.planModel
      .find({ customer: this.toObjectId(userId) })
      .sort({ updatedAt: -1 })
      .exec();
  }

  /**
   * The customer's most recent *active* plan (draft or submitted), used by the
   * Home "Current Event" resolver. BOOKED/CANCELLED plans are excluded — once a
   * plan is booked the booking record is the source of truth, and cancelled
   * plans are not "current". Returns null when there is none.
   */
  getLatestActiveForUser(userId: string): Promise<PlanSubmissionDocument | null> {
    return this.planModel
      .findOne({
        customer: this.toObjectId(userId),
        status: { $in: [PlanStatus.DRAFT, PlanStatus.SUBMITTED] },
      })
      .sort({ updatedAt: -1 })
      .exec();
  }

  async findOne(userId: string, id: string): Promise<PlanSubmissionDocument> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Plan not found');
    const plan = await this.planModel
      .findOne({ _id: id, customer: this.toObjectId(userId) })
      .exec();
    if (!plan) throw new NotFoundException('Plan not found');
    return plan;
  }

  async update(userId: string, id: string, dto: UpsertPlanDto): Promise<PlanSubmissionDocument> {
    const plan = await this.findOne(userId, id);
    Object.assign(plan, dto);
    return plan.save();
  }

  async remove(userId: string, id: string): Promise<void> {
    const plan = await this.findOne(userId, id);
    await plan.deleteOne();
  }
}
