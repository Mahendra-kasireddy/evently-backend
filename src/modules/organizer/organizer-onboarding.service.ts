import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import {
  OnboardingStatus,
  OrganizerProfile,
  OrganizerProfileDocument,
  StoredFile,
} from './schemas/organizer-profile.schema';
import { UpdateOrganizerProfileDto } from './dto/update-organizer-profile.dto';
import { UpdateVerificationDto } from './dto/update-verification.dto';
import { UpdateBankDto } from './dto/update-bank.dto';
import { UpdateServicesDto } from './dto/update-services.dto';
import { UpdatePortfolioDto } from './dto/update-portfolio.dto';
import { StoredFileDto } from './dto/stored-file.dto';
import { OrganizerConfigService } from './organizer-config.service';
import { UserService } from '../user/user.service';
import { UserDocument } from '../user/schemas/user.schema';
import { AuthService } from '../auth/auth.service';
import { NotificationService } from '../notification/notification.service';
import { NotificationType } from '../notification/schemas/notification.schema';
import { Role } from '../../common/enums/role.enum';

type FieldKind = 'text' | 'file' | 'array' | 'number';
interface ReqField {
  key: string;
  label: string;
  kind: FieldKind;
}
interface StepDef {
  id: string;
  title: string;
  required: ReqField[];
}

/** Per-step required fields — drive completion %, step status and submission. */
const STEPS: StepDef[] = [
  {
    id: 'basic',
    title: 'Basic information',
    required: [
      { key: 'firstName', label: 'First name', kind: 'text' },
      { key: 'lastName', label: 'Last name', kind: 'text' },
      { key: 'contactEmail', label: 'Email', kind: 'text' },
      { key: 'businessName', label: 'Business name', kind: 'text' },
      { key: 'businessType', label: 'Business type', kind: 'text' },
      { key: 'primaryCategory', label: 'Primary category', kind: 'text' },
      { key: 'city', label: 'City', kind: 'text' },
      { key: 'profilePhoto', label: 'Profile photo', kind: 'file' },
    ],
  },
  {
    id: 'verification',
    title: 'Verification',
    required: [
      { key: 'aadhaarNumber', label: 'Aadhaar number', kind: 'text' },
      { key: 'panNumber', label: 'PAN number', kind: 'text' },
      { key: 'governmentIdType', label: 'Government ID type', kind: 'text' },
      { key: 'governmentIdFile', label: 'Government ID upload', kind: 'file' },
      { key: 'panFile', label: 'PAN upload', kind: 'file' },
    ],
  },
  {
    id: 'bank',
    title: 'Bank details',
    required: [
      { key: 'accountHolderName', label: 'Account holder name', kind: 'text' },
      { key: 'bankName', label: 'Bank name', kind: 'text' },
      { key: 'accountNumber', label: 'Account number', kind: 'text' },
      { key: 'ifsc', label: 'IFSC', kind: 'text' },
      { key: 'cancelledChequeFile', label: 'Cancelled cheque', kind: 'file' },
    ],
  },
  {
    id: 'services',
    title: 'Services',
    required: [
      { key: 'experience', label: 'Experience', kind: 'text' },
      { key: 'teamSize', label: 'Team size', kind: 'text' },
      { key: 'languages', label: 'Languages', kind: 'array' },
      { key: 'occasions', label: 'Occasions covered', kind: 'array' },
      { key: 'travelOption', label: 'Travel option', kind: 'text' },
      { key: 'workingDays', label: 'Working days', kind: 'array' },
      { key: 'minBudget', label: 'Minimum budget', kind: 'number' },
      { key: 'maxBudget', label: 'Maximum budget', kind: 'number' },
    ],
  },
  {
    id: 'portfolio',
    title: 'Profile & portfolio',
    required: [
      { key: 'businessDescription', label: 'Business description', kind: 'text' },
      { key: 'coverPhoto', label: 'Cover photo', kind: 'file' },
      { key: 'gallery', label: 'Gallery images', kind: 'array' },
    ],
  },
];

const ALL_REQUIRED: Array<ReqField & { stepId: string }> = STEPS.flatMap((s) =>
  s.required.map((f) => ({ ...f, stepId: s.id })),
);

interface FileView {
  url: string;
  key: string;
  originalName: string;
}

export interface OrganizerProfileView {
  id: string;
  onboardingStatus: OnboardingStatus;
  profileCompletion: number;
  submittedAt: string | null;
  // Step 1
  firstName: string;
  lastName: string;
  contactEmail: string;
  mobile: string;
  businessName: string;
  displayName: string;
  businessType: string;
  primaryCategory: string;
  city: string;
  profilePhoto: FileView | null;
  // Step 2
  aadhaarNumber: string;
  panNumber: string;
  gstNumber: string;
  businessRegNumber: string;
  governmentIdType: string;
  governmentIdFile: FileView | null;
  panFile: FileView | null;
  gstFile: FileView | null;
  businessRegFile: FileView | null;
  // Step 3
  accountHolderName: string;
  bankName: string;
  branchName: string;
  accountNumber: string;
  ifsc: string;
  upiId: string;
  cancelledChequeFile: FileView | null;
  // Step 4
  experience: string;
  teamSize: string;
  languages: string[];
  secondaryCategories: string[];
  servicesOffered: string[];
  occasions: string[];
  serviceRadius: number;
  travelOption: string;
  paymentMethods: string[];
  workingDays: string[];
  workingHoursStart: string;
  workingHoursEnd: string;
  minBudget: number;
  maxBudget: number;
  advancePercentage: number;
  emergencyAvailability: boolean;
  destinationEvents: boolean;
  internationalEvents: boolean;
  // Step 5
  tagline: string;
  businessDescription: string;
  yearsOfExperience: number;
  featuredProjects: string[];
  instagram: string;
  facebook: string;
  youtube: string;
  website: string;
  linkedin: string;
  coverPhoto: FileView | null;
  gallery: FileView[];
  videos: FileView[];
  certificates: FileView[];
  awards: FileView[];
  // audit
  createdAt: string | null;
  updatedAt: string | null;
}

@Injectable()
export class OrganizerOnboardingService {
  private readonly logger = new Logger(OrganizerOnboardingService.name);

  constructor(
    @InjectModel(OrganizerProfile.name)
    private readonly profileModel: Model<OrganizerProfileDocument>,
    private readonly configService: OrganizerConfigService,
    private readonly userService: UserService,
    private readonly authService: AuthService,
    private readonly notificationService: NotificationService,
  ) {}

  // ---------------------------------------------------------------------------
  // Registration
  // ---------------------------------------------------------------------------

  async register(
    userId: string,
  ): Promise<{ profile: OrganizerProfileView; token: string; refreshToken: string }> {
    const user = await this.userService.addRole(userId, Role.ORGANIZER);

    let profile = await this.profileModel
      .findOne({ user: new Types.ObjectId(userId), deletedAt: null })
      .exec();

    const isNew = !profile;
    if (!profile) {
      profile = await this.profileModel.create({
        user: new Types.ObjectId(userId),
        name: user.name || 'New organizer',
        onboardingStatus: OnboardingStatus.DRAFT,
        profileCompletion: 0,
        active: false,
      });
      await this.notify(
        userId,
        'Welcome to Evently for Organizers',
        'Your organizer account is ready. Complete your profile to start receiving leads.',
      );
    }

    const tokens = await this.authService.issueSessionForUser(userId);
    this.logger.log(`Organizer register: user=${userId} isNew=${isNew}`);
    return {
      profile: this.toView(profile, user),
      token: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    };
  }

  // ---------------------------------------------------------------------------
  // Profile read
  // ---------------------------------------------------------------------------

  async getProfile(userId: string): Promise<OrganizerProfileView> {
    const { profile, user } = await this.load(userId);
    return this.toView(profile, user);
  }

  // ---------------------------------------------------------------------------
  // Section updates (owner-scoped, autosave-friendly — all fields optional)
  // ---------------------------------------------------------------------------

  /** Step 1 — Basic information. */
  async updateProfile(
    userId: string,
    dto: UpdateOrganizerProfileDto,
  ): Promise<OrganizerProfileView> {
    const { profile, user } = await this.load(userId);

    if (dto.firstName !== undefined) profile.firstName = dto.firstName;
    if (dto.lastName !== undefined) profile.lastName = dto.lastName;
    if (dto.contactEmail !== undefined) profile.contactEmail = dto.contactEmail;
    if (dto.businessName !== undefined) profile.businessName = dto.businessName;
    if (dto.displayName !== undefined) profile.displayName = dto.displayName;
    if (dto.businessType !== undefined) profile.businessType = dto.businessType;
    if (dto.primaryCategory !== undefined) profile.primaryCategory = dto.primaryCategory;
    if (dto.city !== undefined) profile.city = dto.city;
    if (dto.profilePhoto !== undefined) profile.profilePhoto = this.storedFile(dto.profilePhoto);

    const preferredName = profile.displayName || profile.businessName;
    if (preferredName) profile.name = preferredName;

    return this.finalizeSave(userId, profile, user);
  }

  /** Step 2 — Verification (with duplicate PAN / GST detection). */
  async updateVerification(
    userId: string,
    dto: UpdateVerificationDto,
  ): Promise<OrganizerProfileView> {
    const { profile, user } = await this.load(userId);

    if (dto.panNumber) await this.assertUniquePan(profile._id, dto.panNumber);
    if (dto.gstNumber) await this.assertUniqueGst(profile._id, dto.gstNumber);

    if (dto.aadhaarNumber !== undefined) profile.aadhaarNumber = dto.aadhaarNumber;
    if (dto.panNumber !== undefined) profile.panNumber = dto.panNumber;
    if (dto.gstNumber !== undefined) profile.gstNumber = dto.gstNumber;
    if (dto.businessRegNumber !== undefined) profile.businessRegNumber = dto.businessRegNumber;
    if (dto.governmentIdType !== undefined) profile.governmentIdType = dto.governmentIdType;
    if (dto.governmentIdFile !== undefined) {
      profile.governmentIdFile = this.storedFile(dto.governmentIdFile);
    }
    if (dto.panFile !== undefined) profile.panFile = this.storedFile(dto.panFile);
    if (dto.gstFile !== undefined) profile.gstFile = this.storedFile(dto.gstFile);
    if (dto.businessRegFile !== undefined) {
      profile.businessRegFile = this.storedFile(dto.businessRegFile);
    }

    return this.finalizeSave(userId, profile, user);
  }

  /** Step 3 — Bank details. */
  async updateBank(userId: string, dto: UpdateBankDto): Promise<OrganizerProfileView> {
    const { profile, user } = await this.load(userId);

    if (dto.accountHolderName !== undefined) profile.accountHolderName = dto.accountHolderName;
    if (dto.bankName !== undefined) profile.bankName = dto.bankName;
    if (dto.branchName !== undefined) profile.branchName = dto.branchName;
    if (dto.accountNumber !== undefined) profile.accountNumber = dto.accountNumber;
    if (dto.ifsc !== undefined) profile.ifsc = dto.ifsc;
    if (dto.upiId !== undefined) profile.upiId = dto.upiId;
    if (dto.cancelledChequeFile !== undefined) {
      profile.cancelledChequeFile = this.storedFile(dto.cancelledChequeFile);
    }

    return this.finalizeSave(userId, profile, user);
  }

  /** Step 4 — Services. */
  async updateServices(userId: string, dto: UpdateServicesDto): Promise<OrganizerProfileView> {
    const { profile, user } = await this.load(userId);

    if (dto.experience !== undefined) profile.experience = dto.experience;
    if (dto.teamSize !== undefined) profile.teamSize = dto.teamSize;
    if (dto.languages !== undefined) profile.languages = dto.languages;
    if (dto.secondaryCategories !== undefined)
      profile.secondaryCategories = dto.secondaryCategories;
    if (dto.servicesOffered !== undefined) profile.servicesOffered = dto.servicesOffered;
    if (dto.occasions !== undefined) profile.occasions = dto.occasions;
    if (dto.serviceRadius !== undefined) profile.serviceRadius = dto.serviceRadius;
    if (dto.travelOption !== undefined) profile.travelOption = dto.travelOption;
    if (dto.paymentMethods !== undefined) profile.paymentMethods = dto.paymentMethods;
    if (dto.workingDays !== undefined) profile.workingDays = dto.workingDays;
    if (dto.workingHoursStart !== undefined) profile.workingHoursStart = dto.workingHoursStart;
    if (dto.workingHoursEnd !== undefined) profile.workingHoursEnd = dto.workingHoursEnd;
    if (dto.minBudget !== undefined) profile.minBudget = dto.minBudget;
    if (dto.maxBudget !== undefined) profile.maxBudget = dto.maxBudget;
    if (dto.advancePercentage !== undefined) profile.advancePercentage = dto.advancePercentage;
    if (dto.emergencyAvailability !== undefined) {
      profile.emergencyAvailability = dto.emergencyAvailability;
    }
    if (dto.destinationEvents !== undefined) profile.destinationEvents = dto.destinationEvents;
    if (dto.internationalEvents !== undefined)
      profile.internationalEvents = dto.internationalEvents;

    return this.finalizeSave(userId, profile, user);
  }

  /** Step 5 — Portfolio. */
  async updatePortfolio(userId: string, dto: UpdatePortfolioDto): Promise<OrganizerProfileView> {
    const { profile, user } = await this.load(userId);

    if (dto.tagline !== undefined) profile.tagline = dto.tagline;
    if (dto.businessDescription !== undefined)
      profile.businessDescription = dto.businessDescription;
    if (dto.yearsOfExperience !== undefined) profile.yearsOfExperience = dto.yearsOfExperience;
    if (dto.featuredProjects !== undefined) profile.featuredProjects = dto.featuredProjects;
    if (dto.instagram !== undefined) profile.instagram = dto.instagram;
    if (dto.facebook !== undefined) profile.facebook = dto.facebook;
    if (dto.youtube !== undefined) profile.youtube = dto.youtube;
    if (dto.website !== undefined) profile.website = dto.website;
    if (dto.linkedin !== undefined) profile.linkedin = dto.linkedin;
    if (dto.coverPhoto !== undefined) profile.coverPhoto = this.storedFile(dto.coverPhoto);
    if (dto.gallery !== undefined) profile.gallery = this.storedFiles(dto.gallery);
    if (dto.videos !== undefined) profile.videos = this.storedFiles(dto.videos);
    if (dto.certificates !== undefined) profile.certificates = this.storedFiles(dto.certificates);
    if (dto.awards !== undefined) profile.awards = this.storedFiles(dto.awards);

    return this.finalizeSave(userId, profile, user);
  }

  // ---------------------------------------------------------------------------
  // Status / completion / submit
  // ---------------------------------------------------------------------------

  async getOnboardingStatus(userId: string): Promise<{
    onboardingStatus: OnboardingStatus;
    profileCompletion: number;
    currentStep: string;
    completedSteps: string[];
    submittedAt: string | null;
    steps: Array<{ id: string; title: string; complete: boolean; missingFields: string[] }>;
  }> {
    const { profile } = await this.load(userId);
    const steps = this.stepStatus(profile);
    const completedSteps = steps.filter((s) => s.complete).map((s) => s.id);
    const currentStep = steps.find((s) => !s.complete)?.id ?? steps[steps.length - 1]!.id;
    return {
      onboardingStatus: profile.onboardingStatus,
      profileCompletion: this.overall(profile).percent,
      currentStep,
      completedSteps,
      submittedAt: profile.submittedAt ? profile.submittedAt.toISOString() : null,
      steps,
    };
  }

  async getProfileCompletion(userId: string): Promise<{
    completionPercentage: number;
    currentStep: string;
    completedSteps: string[];
    missingFields: string[];
  }> {
    const { profile } = await this.load(userId);
    const steps = this.stepStatus(profile);
    const { percent, missing } = this.overall(profile);
    return {
      completionPercentage: percent,
      currentStep: steps.find((s) => !s.complete)?.id ?? steps[steps.length - 1]!.id,
      completedSteps: steps.filter((s) => s.complete).map((s) => s.id),
      missingFields: missing.map((m) => m.label),
    };
  }

  /** Submits the full profile for verification once every required field is present. */
  async completeOnboarding(userId: string): Promise<OrganizerProfileView> {
    const { profile, user } = await this.load(userId);

    const { missing } = this.overall(profile);
    if (missing.length > 0) {
      throw new BadRequestException(`Please complete: ${missing.map((m) => m.label).join(', ')}`);
    }

    const [btOk, catOk, cityOk] = await Promise.all([
      this.configService.businessTypeExists(profile.businessType),
      this.configService.categoryExists(profile.primaryCategory),
      this.configService.cityExists(profile.city),
    ]);
    if (!btOk) throw new BadRequestException('Invalid business type');
    if (!catOk) throw new BadRequestException('Invalid primary category');
    if (!cityOk) throw new BadRequestException('Invalid city');

    profile.onboardingStatus = OnboardingStatus.SUBMITTED;
    profile.submittedAt = new Date();
    // No admin-review gate exists yet — a submitted, fully-completed profile
    // goes live immediately so customers can find and request quotes from it.
    profile.active = true;
    await profile.save();
    await this.syncUserFromProfile(user, profile);

    await this.notify(
      userId,
      'Profile submitted and live',
      'Thanks! Your profile is complete, submitted, and now visible to customers looking for organizers.',
    );
    return this.toView(profile, user);
  }

  /**
   * Copies the organizer's real name/email/city onto their base account. The
   * base User record is created phone-only at signup (no name/email/city) and
   * is never populated any other way — every onboarding field before this
   * point is written only to OrganizerProfile. Best-effort: email has a
   * unique index, so a collision here shouldn't fail the whole submission.
   */
  private async syncUserFromProfile(
    user: UserDocument,
    profile: OrganizerProfileDocument,
  ): Promise<void> {
    const fullName = `${profile.firstName} ${profile.lastName}`.trim();
    if (fullName) user.name = fullName;
    if (profile.contactEmail) user.email = profile.contactEmail;
    if (profile.city) user.city = profile.city;
    try {
      await user.save();
    } catch (err) {
      this.logger.warn(`User sync from organizer profile failed: ${String(err)}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async load(
    userId: string,
  ): Promise<{ profile: OrganizerProfileDocument; user: UserDocument }> {
    const [profile, user] = await Promise.all([
      this.profileModel.findOne({ user: new Types.ObjectId(userId), deletedAt: null }).exec(),
      this.userService.findById(userId),
    ]);
    if (!profile) {
      throw new NotFoundException('Organizer profile not found — register first');
    }
    return { profile, user };
  }

  /** Recomputes completion, advances status, fires the 100% notification, saves. */
  private async finalizeSave(
    userId: string,
    profile: OrganizerProfileDocument,
    user: UserDocument,
  ): Promise<OrganizerProfileView> {
    const wasComplete = (profile.profileCompletion ?? 0) >= 100;
    const { percent } = this.overall(profile);
    profile.profileCompletion = percent;
    if (profile.onboardingStatus === OnboardingStatus.DRAFT && percent > 0) {
      profile.onboardingStatus = OnboardingStatus.IN_PROGRESS;
    }
    await profile.save();

    if (
      !wasComplete &&
      percent === 100 &&
      profile.onboardingStatus !== OnboardingStatus.SUBMITTED
    ) {
      await this.notify(
        userId,
        'Profile completed',
        'Your organizer profile is 100% complete. Submit it for verification whenever you’re ready.',
      );
    }
    return this.toView(profile, user);
  }

  private async assertUniquePan(selfId: Types.ObjectId, pan: string): Promise<void> {
    const exists = await this.profileModel
      .exists({ panNumber: pan.toUpperCase(), _id: { $ne: selfId }, deletedAt: null })
      .exec();
    if (exists) throw new ConflictException('This PAN is already registered');
  }

  private async assertUniqueGst(selfId: Types.ObjectId, gst: string): Promise<void> {
    const exists = await this.profileModel
      .exists({ gstNumber: gst.toUpperCase(), _id: { $ne: selfId }, deletedAt: null })
      .exec();
    if (exists) throw new ConflictException('This GST number is already registered');
  }

  private isFilled(profile: OrganizerProfileDocument, field: ReqField): boolean {
    const val = (profile as unknown as Record<string, unknown>)[field.key];
    switch (field.kind) {
      case 'file':
        return !!(val as StoredFile | null)?.url;
      case 'array':
        return Array.isArray(val) && val.length > 0;
      case 'number':
        return typeof val === 'number' && val > 0;
      default:
        return typeof val === 'string' && val.trim() !== '';
    }
  }

  private stepStatus(
    profile: OrganizerProfileDocument,
  ): Array<{ id: string; title: string; complete: boolean; missingFields: string[] }> {
    return STEPS.map((step) => {
      const missingFields = step.required
        .filter((f) => !this.isFilled(profile, f))
        .map((f) => f.label);
      return {
        id: step.id,
        title: step.title,
        complete: missingFields.length === 0,
        missingFields,
      };
    });
  }

  private overall(profile: OrganizerProfileDocument): {
    percent: number;
    missing: Array<ReqField & { stepId: string }>;
  } {
    const missing = ALL_REQUIRED.filter((f) => !this.isFilled(profile, f));
    const filled = ALL_REQUIRED.length - missing.length;
    const percent = Math.round((filled / ALL_REQUIRED.length) * 100);
    return { percent, missing };
  }

  private storedFile(dto?: StoredFileDto): StoredFile | null {
    if (!dto) return null;
    return {
      url: dto.url,
      key: dto.key,
      originalName: dto.originalName ?? '',
      mimeType: dto.mimeType ?? '',
      size: dto.size ?? 0,
      uploadedAt: dto.uploadedAt ? new Date(dto.uploadedAt) : new Date(),
    };
  }

  private storedFiles(dtos: StoredFileDto[]): StoredFile[] {
    return dtos.map((d) => this.storedFile(d)).filter((f): f is StoredFile => f !== null);
  }

  private fileView(f?: StoredFile | null): FileView | null {
    return f?.url ? { url: f.url, key: f.key, originalName: f.originalName } : null;
  }

  private fileViews(files: StoredFile[]): FileView[] {
    return (files ?? [])
      .filter((f) => f?.url)
      .map((f) => ({ url: f.url, key: f.key, originalName: f.originalName }));
  }

  private toView(profile: OrganizerProfileDocument, user: UserDocument): OrganizerProfileView {
    return {
      id: profile._id.toString(),
      onboardingStatus: profile.onboardingStatus,
      profileCompletion: profile.profileCompletion,
      submittedAt: profile.submittedAt ? profile.submittedAt.toISOString() : null,
      firstName: profile.firstName,
      lastName: profile.lastName,
      contactEmail: profile.contactEmail,
      mobile: user.phone ?? '',
      businessName: profile.businessName,
      displayName: profile.displayName,
      businessType: profile.businessType,
      primaryCategory: profile.primaryCategory,
      city: profile.city,
      profilePhoto: this.fileView(profile.profilePhoto),
      aadhaarNumber: profile.aadhaarNumber,
      panNumber: profile.panNumber,
      gstNumber: profile.gstNumber,
      businessRegNumber: profile.businessRegNumber,
      governmentIdType: profile.governmentIdType,
      governmentIdFile: this.fileView(profile.governmentIdFile),
      panFile: this.fileView(profile.panFile),
      gstFile: this.fileView(profile.gstFile),
      businessRegFile: this.fileView(profile.businessRegFile),
      accountHolderName: profile.accountHolderName,
      bankName: profile.bankName,
      branchName: profile.branchName,
      accountNumber: profile.accountNumber,
      ifsc: profile.ifsc,
      upiId: profile.upiId,
      cancelledChequeFile: this.fileView(profile.cancelledChequeFile),
      experience: profile.experience,
      teamSize: profile.teamSize,
      languages: profile.languages ?? [],
      secondaryCategories: profile.secondaryCategories ?? [],
      servicesOffered: profile.servicesOffered ?? [],
      occasions: profile.occasions ?? [],
      serviceRadius: profile.serviceRadius,
      travelOption: profile.travelOption,
      paymentMethods: profile.paymentMethods ?? [],
      workingDays: profile.workingDays ?? [],
      workingHoursStart: profile.workingHoursStart,
      workingHoursEnd: profile.workingHoursEnd,
      minBudget: profile.minBudget,
      maxBudget: profile.maxBudget,
      advancePercentage: profile.advancePercentage,
      emergencyAvailability: profile.emergencyAvailability,
      destinationEvents: profile.destinationEvents,
      internationalEvents: profile.internationalEvents,
      tagline: profile.tagline,
      businessDescription: profile.businessDescription,
      yearsOfExperience: profile.yearsOfExperience,
      featuredProjects: profile.featuredProjects ?? [],
      instagram: profile.instagram,
      facebook: profile.facebook,
      youtube: profile.youtube,
      website: profile.website,
      linkedin: profile.linkedin,
      coverPhoto: this.fileView(profile.coverPhoto),
      gallery: this.fileViews(profile.gallery),
      videos: this.fileViews(profile.videos),
      certificates: this.fileViews(profile.certificates),
      awards: this.fileViews(profile.awards),
      createdAt: profile.get('createdAt')?.toISOString?.() ?? null,
      updatedAt: profile.get('updatedAt')?.toISOString?.() ?? null,
    };
  }

  /** Best-effort notification — never blocks the business operation. */
  private async notify(userId: string, title: string, body: string): Promise<void> {
    try {
      await this.notificationService.create(
        userId,
        title,
        body,
        NotificationType.SYSTEM,
        '/onboarding/organizer',
      );
    } catch (err) {
      this.logger.warn(`Organizer notification failed: ${String(err)}`);
    }
  }
}
