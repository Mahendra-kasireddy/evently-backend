import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { idJsonTransform } from '../../../common/utils/id-transform';
import { HydratedDocument, Types } from 'mongoose';

export type PlanSubmissionDocument = HydratedDocument<PlanSubmission>;

export enum PlanStatus {
  DRAFT = 'draft',
  SUBMITTED = 'submitted',
  QUOTED = 'quoted',
  BOOKED = 'booked',
  CANCELLED = 'cancelled',
}

/**
 * A customer's event plan captured from the Plan Event wizard. Persists the
 * full draft so it can be resumed, submitted (quotes requested), and tracked.
 * One live DRAFT per customer is kept; submitting promotes it to SUBMITTED.
 */
@Schema({
  timestamps: true,
  collection: 'plan_submissions',
  toJSON: idJsonTransform(),
})
export class PlanSubmission {
  // Owning customer.
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  customer: Types.ObjectId;

  // Human-friendly reference, e.g. "PLN-7F3K2Q". Generated on submit.
  @Prop({ trim: true, index: true })
  planCode?: string;

  // Occasion slug (references plan_occasions.key).
  @Prop({ required: true, trim: true })
  occasion: string;

  @Prop({ type: Date })
  eventDate?: Date;

  @Prop({ trim: true, default: '' })
  city: string;

  @Prop({ trim: true, default: '' })
  area: string;

  // Coarse guest-count bucket display value (references plan_guest_ranges.value).
  @Prop({ trim: true, default: '' })
  guests: string;

  // Optional budget bucket display value (references plan_budget_ranges.value).
  @Prop({ trim: true, default: '' })
  budget: string;

  @Prop({ trim: true, default: '', maxlength: 5000 })
  ideas: string;

  // Selected service-category keys (references plan_service_categories.key).
  @Prop({ type: [String], default: [] })
  categories: string[];

  @Prop({ type: String, enum: PlanStatus, default: PlanStatus.DRAFT, index: true })
  status: PlanStatus;
}

export const PlanSubmissionSchema = SchemaFactory.createForClass(PlanSubmission);

// One customer typically resumes their most recent plan.
PlanSubmissionSchema.index({ customer: 1, updatedAt: -1 });
