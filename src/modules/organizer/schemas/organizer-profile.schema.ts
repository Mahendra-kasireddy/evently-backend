import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { idJsonTransform } from '../../../common/utils/id-transform';
import { HydratedDocument, Types } from 'mongoose';

export type OrganizerProfileDocument = HydratedDocument<OrganizerProfile>;

export enum OrganizerTier {
  SILVER = 'Silver',
  GOLD = 'Gold',
  PLATINUM = 'Platinum',
}

/** Onboarding lifecycle for a self-registered organizer. */
export enum OnboardingStatus {
  DRAFT = 'draft', // registered; still filling in details
  IN_PROGRESS = 'in_progress', // some steps saved
  SUBMITTED = 'submitted', // submitted for verification
  APPROVED = 'approved', // verified & live
  REJECTED = 'rejected', // needs changes
}

/** File metadata persisted for an uploaded asset (mirrors UploadedFileMeta). */
@Schema({ _id: false })
export class StoredFile {
  @Prop({ trim: true, default: '' })
  url: string;

  @Prop({ trim: true, default: '' })
  key: string;

  @Prop({ trim: true, default: '' })
  originalName: string;

  @Prop({ trim: true, default: '' })
  mimeType: string;

  @Prop({ default: 0 })
  size: number;

  @Prop({ type: Date })
  uploadedAt?: Date;
}
export const StoredFileSchema = SchemaFactory.createForClass(StoredFile);

@Schema({
  timestamps: true,
  collection: 'organizer_profiles',
  toJSON: idJsonTransform(),
})
export class OrganizerProfile {
  // Optional link to the owning user account (role = organizer).
  @Prop({ type: Types.ObjectId, ref: 'User', index: true })
  user?: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name: string;

  // 2-letter monogram shown on the avatar, e.g. "SE".
  @Prop({ trim: true, default: '' })
  initials: string;

  @Prop({ trim: true, default: '#7c5bd6' })
  avatarColor: string;

  @Prop({ type: String, enum: OrganizerTier, default: OrganizerTier.SILVER })
  tier: OrganizerTier;

  @Prop({ default: 0, min: 0, max: 5 })
  rating: number;

  @Prop({ default: 0, min: 0 })
  reviews: number;

  // Number of events delivered.
  @Prop({ default: 0, min: 0 })
  events: number;

  @Prop({ type: [String], default: [] })
  tags: string[];

  // Service area shown on the plan cards, e.g. "Banjara Hills" (base locality).
  @Prop({ trim: true, default: '' })
  location: string;

  // Localities the organizer serves — drives location scoring beyond the base.
  @Prop({ type: [String], default: [] })
  serviceAreas: string[];

  // Occasion keys the organizer specializes in (references plan_occasions.key).
  @Prop({ type: [String], default: [] })
  occasions: string[];

  // Guest-capacity range the organizer can comfortably deliver.
  @Prop({ default: 0, min: 0 })
  capacityMin: number;

  @Prop({ default: 0, min: 0 })
  capacityMax: number;

  // Pricing inputs for the DYNAMIC estimate (rupees). basePrice = coordination
  // baseline; pricePerGuest drives per-head services; categoryRates carries the
  // per-service prices (perGuest flag = multiply by guest count).
  @Prop({ default: 0, min: 0 })
  basePrice: number;

  @Prop({ default: 0, min: 0 })
  pricePerGuest: number;

  @Prop({
    type: [{ key: String, price: Number, perGuest: Boolean, _id: false }],
    default: [],
  })
  categoryRates: { key: string; price: number; perGuest: boolean }[];

  // Responsiveness signals.
  @Prop({ default: 90, min: 0, max: 100 })
  responseRate: number;

  @Prop({ default: 24, min: 0 })
  responseHours: number;

  // Dates the organizer is already booked (availability check).
  @Prop({ type: [Date], default: [] })
  busyDates: Date[];

  // Venue capability.
  @Prop({ default: true })
  indoor: boolean;

  @Prop({ default: true })
  outdoor: boolean;

  // Legacy static estimate — retained for back-compat; the engine now computes
  // a dynamic estRange from the pricing fields above.
  @Prop({ trim: true, default: '' })
  estRange: string;

  // Evently's own house/concierge account — a guaranteed fallback that can
  // arrange any event. Always surfaced (after real matches) so the customer is
  // never left with an empty recommendation list.
  @Prop({ default: false, index: true })
  concierge: boolean;

  // Home ranking weight (higher shows first) + active flag.
  @Prop({ default: 0, index: true })
  rank: number;

  @Prop({ default: true, index: true })
  active: boolean;

  // ===========================================================================
  // Onboarding / registration (self-service organizers). Seeded marketing
  // profiles leave these at defaults; self-registered organizers fill them in.
  // ===========================================================================

  // ---- Step 1: Basic information (personal) ----
  @Prop({ trim: true, default: '' })
  firstName: string;

  @Prop({ trim: true, default: '' })
  lastName: string;

  // Contact email captured during onboarding (NOT an auth credential — auth is
  // phone-OTP on the linked User).
  @Prop({ lowercase: true, trim: true, default: '' })
  contactEmail: string;

  @Prop({ type: StoredFileSchema, default: null })
  profilePhoto?: StoredFile | null;

  // ---- Step 1: Basic information (business identity) ----
  @Prop({ trim: true, default: '' })
  businessName: string;

  @Prop({ trim: true, default: '' })
  displayName: string;

  // References business_types.key
  @Prop({ trim: true, default: '', index: true })
  businessType: string;

  // References organizer_categories.key
  @Prop({ trim: true, default: '', index: true })
  primaryCategory: string;

  // References plan_cities.name (reused city list)
  @Prop({ trim: true, default: '' })
  city: string;

  // ---- Onboarding metadata ----
  @Prop({
    type: String,
    enum: OnboardingStatus,
    default: OnboardingStatus.DRAFT,
    index: true,
  })
  onboardingStatus: OnboardingStatus;

  // 0–100, recomputed on every save from the required-field set.
  @Prop({ default: 0, min: 0, max: 100 })
  profileCompletion: number;

  @Prop({ type: Date })
  submittedAt?: Date;

  // Soft delete — excluded from all reads; audit timestamps come from { timestamps }.
  @Prop({ type: Date, default: null, index: true })
  deletedAt: Date | null;

  // ---- Step 2: Verification ----
  @Prop({ trim: true, default: '' })
  aadhaarNumber: string;

  // Stored uppercase; partial-unique across profiles.
  @Prop({ uppercase: true, trim: true, default: '' })
  panNumber: string;

  @Prop({ uppercase: true, trim: true, default: '' })
  gstNumber: string;

  @Prop({ trim: true, default: '' })
  businessRegNumber: string;

  // References document_types.key (e.g. "aadhaar", "passport", "voter_id").
  @Prop({ trim: true, default: '' })
  governmentIdType: string;

  @Prop({ type: StoredFileSchema, default: null })
  governmentIdFile?: StoredFile | null;

  @Prop({ type: StoredFileSchema, default: null })
  panFile?: StoredFile | null;

  @Prop({ type: StoredFileSchema, default: null })
  gstFile?: StoredFile | null;

  @Prop({ type: StoredFileSchema, default: null })
  businessRegFile?: StoredFile | null;

  // ---- Step 3: Bank details ----
  @Prop({ trim: true, default: '' })
  accountHolderName: string;

  @Prop({ trim: true, default: '' })
  bankName: string;

  @Prop({ trim: true, default: '' })
  branchName: string;

  @Prop({ trim: true, default: '' })
  accountNumber: string;

  @Prop({ uppercase: true, trim: true, default: '' })
  ifsc: string;

  @Prop({ trim: true, default: '' })
  upiId: string;

  @Prop({ type: StoredFileSchema, default: null })
  cancelledChequeFile?: StoredFile | null;

  // ---- Step 4: Services ----
  // References experience_ranges.key
  @Prop({ trim: true, default: '' })
  experience: string;

  // References team_sizes.key
  @Prop({ trim: true, default: '' })
  teamSize: string;

  // References languages.key
  @Prop({ type: [String], default: [] })
  languages: string[];

  // References organizer_categories.key (secondary specialisms).
  @Prop({ type: [String], default: [] })
  secondaryCategories: string[];

  // References plan_service_categories.key (individual services delivered).
  @Prop({ type: [String], default: [] })
  servicesOffered: string[];

  // NOTE: "Occasions Covered" reuses the existing `occasions` field above.

  @Prop({ default: 0, min: 0 })
  serviceRadius: number;

  // References travel_options.key
  @Prop({ trim: true, default: '' })
  travelOption: string;

  // References payment_methods.key
  @Prop({ type: [String], default: [] })
  paymentMethods: string[];

  // References working_days.key (e.g. "mon", "tue" …).
  @Prop({ type: [String], default: [] })
  workingDays: string[];

  @Prop({ trim: true, default: '' })
  workingHoursStart: string;

  @Prop({ trim: true, default: '' })
  workingHoursEnd: string;

  @Prop({ default: 0, min: 0 })
  minBudget: number;

  @Prop({ default: 0, min: 0 })
  maxBudget: number;

  @Prop({ default: 0, min: 0, max: 100 })
  advancePercentage: number;

  @Prop({ default: false })
  emergencyAvailability: boolean;

  @Prop({ default: false })
  destinationEvents: boolean;

  @Prop({ default: false })
  internationalEvents: boolean;

  // ---- Step 5: Portfolio ----
  @Prop({ trim: true, default: '', maxlength: 4000 })
  businessDescription: string;

  @Prop({ default: 0, min: 0 })
  yearsOfExperience: number;

  @Prop({ type: [String], default: [] })
  featuredProjects: string[];

  @Prop({ trim: true, default: '' })
  instagram: string;

  @Prop({ trim: true, default: '' })
  facebook: string;

  @Prop({ trim: true, default: '' })
  youtube: string;

  @Prop({ trim: true, default: '' })
  website: string;

  @Prop({ trim: true, default: '' })
  linkedin: string;

  @Prop({ type: StoredFileSchema, default: null })
  coverPhoto?: StoredFile | null;

  @Prop({ type: [StoredFileSchema], default: [] })
  gallery: StoredFile[];

  @Prop({ type: [StoredFileSchema], default: [] })
  videos: StoredFile[];

  @Prop({ type: [StoredFileSchema], default: [] })
  certificates: StoredFile[];

  @Prop({ type: [StoredFileSchema], default: [] })
  awards: StoredFile[];
}

export const OrganizerProfileSchema = SchemaFactory.createForClass(OrganizerProfile);

// One organizer profile per user (self-registered). Partial so the many seeded
// marketing profiles without a `user` are exempt from the uniqueness constraint.
OrganizerProfileSchema.index(
  { user: 1 },
  { unique: true, partialFilterExpression: { user: { $exists: true } } },
);

// PAN/GST are unique across organizer profiles when present (non-empty). The DB
// index is the safety net; the service also returns a friendly 409 on conflict.
OrganizerProfileSchema.index(
  { panNumber: 1 },
  { unique: true, partialFilterExpression: { panNumber: { $gt: '' } } },
);
OrganizerProfileSchema.index(
  { gstNumber: 1 },
  { unique: true, partialFilterExpression: { gstNumber: { $gt: '' } } },
);
