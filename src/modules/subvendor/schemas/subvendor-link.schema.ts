import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { idJsonTransform } from '../../../common/utils/id-transform';
import { HydratedDocument, Types } from 'mongoose';

export type SubVendorLinkDocument = HydratedDocument<SubVendorLink>;

export enum SubVendorLinkStatus {
  /** Organizer invited a phone number that hasn't completed sub-vendor signup yet. */
  PENDING = 'pending',
  ACTIVE = 'active',
  REMOVED = 'removed',
}

/**
 * Many-to-many relationship between an organizer and a sub-vendor. Created
 * from either side — the organizer inviting a phone number (P-08), or the
 * sub-vendor entering the organizer's phone during their own onboarding
 * (LinkStep) — both resolve to the same link shape.
 */
@Schema({
  timestamps: true,
  collection: 'subvendor_links',
  toJSON: idJsonTransform(),
})
export class SubVendorLink {
  @Prop({ type: Types.ObjectId, ref: 'OrganizerProfile', required: true, index: true })
  organizer: Types.ObjectId;

  // Null until the invited phone completes sub-vendor signup.
  @Prop({ type: Types.ObjectId, ref: 'SubVendorProfile', index: true })
  subVendor?: Types.ObjectId;

  // 10-digit mobile the organizer invited, kept so signup can auto-resolve the link.
  @Prop({ trim: true, index: true })
  invitedPhone?: string;

  @Prop({
    type: String,
    enum: SubVendorLinkStatus,
    default: SubVendorLinkStatus.PENDING,
    index: true,
  })
  status: SubVendorLinkStatus;

  // Organizer's rating of this sub-vendor's work (1-5). 0 = not yet rated.
  @Prop({ default: 0, min: 0, max: 5 })
  ratingTotal: number;

  @Prop({ default: 0, min: 0 })
  ratingCount: number;

  createdAt?: Date;
  updatedAt?: Date;
}

export const SubVendorLinkSchema = SchemaFactory.createForClass(SubVendorLink);

// Not a unique index — uniqueness (per organizer+subVendor, or per
// organizer+invitedPhone) is enforced in SubvendorService before insert,
// since a compound unique index can't cleanly express "unique only when
// subVendor is set, else unique on invitedPhone instead".
SubVendorLinkSchema.index({ organizer: 1, subVendor: 1 });
SubVendorLinkSchema.index({ organizer: 1, invitedPhone: 1 });
