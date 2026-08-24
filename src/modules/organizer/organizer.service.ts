import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  OrganizerProfile,
  OrganizerProfileDocument,
  StoredFile,
} from './schemas/organizer-profile.schema';

interface FileView {
  url: string;
  key: string;
  originalName: string;
}

/**
 * Everything a customer is allowed to see about an organizer — the public
 * counterpart of OrganizerOnboardingService's owner-only OrganizerProfileView.
 * Deliberately excludes: KYC identity documents (Aadhaar/PAN/GST/business
 * registration + their uploaded files), bank/payout details, contact email,
 * legal first/last name, and internal onboarding workflow state. Those fields
 * only ever belong in the owner-scoped `/organizer/profile` response.
 */
export interface PublicOrganizerView {
  id: string;
  name: string;
  initials: string;
  avatarColor: string;
  tier: string;
  rating: number;
  reviews: number;
  events: number;
  tags: string[];
  location: string;
  serviceAreas: string[];
  occasions: string[];
  capacityMin: number;
  capacityMax: number;
  basePrice: number;
  pricePerGuest: number;
  categoryRates: { key: string; price: number; perGuest: boolean }[];
  responseRate: number;
  responseHours: number;
  indoor: boolean;
  outdoor: boolean;
  estRange: string;
  concierge: boolean;
  businessName: string;
  displayName: string;
  businessType: string;
  primaryCategory: string;
  city: string;
  profilePhoto: FileView | null;
  tagline: string;
  experience: string;
  teamSize: string;
  languages: string[];
  secondaryCategories: string[];
  servicesOffered: string[];
  travelOption: string;
  workingDays: string[];
  workingHoursStart: string;
  workingHoursEnd: string;
  minBudget: number;
  maxBudget: number;
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
  createdAt: string | null;
}

/**
 * The owner's own public projection, plus whether it is actually live to
 * customers. Backs the "Live customer preview" pane on the organizer profile
 * screen: it must render exactly what `findPublicById` returns, but it cannot
 * go through that method because a not-yet-approved profile is `active: false`
 * and would 404.
 */
export interface OrganizerPreviewView extends PublicOrganizerView {
  isLive: boolean;
}

@Injectable()
export class OrganizerService {
  constructor(
    @InjectModel(OrganizerProfile.name)
    private readonly organizerModel: Model<OrganizerProfileDocument>,
  ) {}

  /** Top-ranked active organizers, ignoring location. */
  async findTop(limit = 6): Promise<PublicOrganizerView[]> {
    const docs = await this.organizerModel
      .find({ active: true })
      .sort({ rank: -1, rating: -1 })
      .limit(limit)
      .exec();
    return docs.map((d) => this.toPublicView(d));
  }

  /**
   * Top organizers for the home "near you" section, widening in steps so the
   * heading is never a lie:
   *
   *   city    → organizers whose city, served localities or base locality match
   *             the customer's city — which is what "near you" claims
   *   all     → nothing local yet, so the best available anywhere
   *   (empty) → no active organizers at all; the client shows its own prompt
   *
   * `scope` travels with the result so the UI can say which of those happened
   * instead of silently presenting distant organizers as local ones.
   */
  async findTopNear(
    city: string | undefined,
    limit = 6,
  ): Promise<{ organizers: PublicOrganizerView[]; scope: 'city' | 'all' }> {
    const trimmed = (city ?? '').trim();
    if (trimmed) {
      const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const local = await this.organizerModel
        .find({
          active: true,
          $or: [
            { city: new RegExp(`^${escaped}$`, 'i') },
            { serviceAreas: new RegExp(escaped, 'i') },
            { location: new RegExp(escaped, 'i') },
          ],
        })
        .sort({ rank: -1, rating: -1 })
        .limit(limit)
        .exec();
      if (local.length > 0) {
        return { organizers: local.map((d) => this.toPublicView(d)), scope: 'city' };
      }
    }
    return { organizers: await this.findTop(limit), scope: 'all' };
  }

  /** All active organizers (for the plan "find organizers" step). */
  findAllActive(): Promise<OrganizerProfileDocument[]> {
    return this.organizerModel.find({ active: true }).sort({ rating: -1 }).exec();
  }

  /**
   * Internal, unfiltered lookup by id — returns the full document (including
   * `user`), for server-side callers that need to act on any profile
   * regardless of its `active` status (e.g. notifying the linked user on a
   * new quote request). NOT for HTTP responses — see `findPublicById`.
   */
  async findById(id: string): Promise<OrganizerProfileDocument> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Organizer not found');
    const organizer = await this.organizerModel.findById(id).exec();
    if (!organizer) throw new NotFoundException('Organizer not found');
    return organizer;
  }

  /** Public "view profile" lookup — sanitized fields, active organizers only. */
  async findPublicById(id: string): Promise<PublicOrganizerView> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Organizer not found');
    const organizer = await this.organizerModel.findOne({ _id: id, active: true }).exec();
    if (!organizer) throw new NotFoundException('Organizer not found');
    return this.toPublicView(organizer);
  }

  /** The organizer profile owned by a given user account (null if none). */
  findByUser(userId: string): Promise<OrganizerProfileDocument | null> {
    if (!Types.ObjectId.isValid(userId)) return Promise.resolve(null);
    return this.organizerModel.findOne({ user: new Types.ObjectId(userId) }).exec();
  }

  /**
   * Owner-scoped "what customers see" projection for the organizer's own
   * profile screen. Reuses the exact public projection so the preview can never
   * drift from the real customer-facing profile, and reports `isLive` so the UI
   * can explain why an unapproved profile is not discoverable yet.
   */
  async previewForOwner(userId: string): Promise<OrganizerPreviewView> {
    const profile = await this.organizerModel
      .findOne({ user: new Types.ObjectId(userId), deletedAt: null })
      .exec();
    if (!profile) {
      throw new NotFoundException('Organizer profile not found \u2014 register first');
    }
    return { ...this.toPublicView(profile), isLive: profile.active };
  }

  private fileView(f?: StoredFile | null): FileView | null {
    return f?.url ? { url: f.url, key: f.key, originalName: f.originalName } : null;
  }

  private fileViews(files: StoredFile[] | undefined): FileView[] {
    return (files ?? [])
      .filter((f) => f?.url)
      .map((f) => ({ url: f.url, key: f.key, originalName: f.originalName }));
  }

  private toPublicView(doc: OrganizerProfileDocument): PublicOrganizerView {
    return {
      id: doc._id.toString(),
      name: doc.name,
      initials: doc.initials,
      avatarColor: doc.avatarColor,
      tier: doc.tier,
      rating: doc.rating,
      reviews: doc.reviews,
      events: doc.events,
      tags: doc.tags ?? [],
      location: doc.location,
      serviceAreas: doc.serviceAreas ?? [],
      occasions: doc.occasions ?? [],
      capacityMin: doc.capacityMin,
      capacityMax: doc.capacityMax,
      basePrice: doc.basePrice,
      pricePerGuest: doc.pricePerGuest,
      categoryRates: doc.categoryRates ?? [],
      responseRate: doc.responseRate,
      responseHours: doc.responseHours,
      indoor: doc.indoor,
      outdoor: doc.outdoor,
      estRange: doc.estRange,
      concierge: doc.concierge,
      businessName: doc.businessName,
      displayName: doc.displayName,
      businessType: doc.businessType,
      primaryCategory: doc.primaryCategory,
      city: doc.city,
      profilePhoto: this.fileView(doc.profilePhoto),
      tagline: doc.tagline,
      experience: doc.experience,
      teamSize: doc.teamSize,
      languages: doc.languages ?? [],
      secondaryCategories: doc.secondaryCategories ?? [],
      servicesOffered: doc.servicesOffered ?? [],
      travelOption: doc.travelOption,
      workingDays: doc.workingDays ?? [],
      workingHoursStart: doc.workingHoursStart,
      workingHoursEnd: doc.workingHoursEnd,
      minBudget: doc.minBudget,
      maxBudget: doc.maxBudget,
      businessDescription: doc.businessDescription,
      yearsOfExperience: doc.yearsOfExperience,
      featuredProjects: doc.featuredProjects ?? [],
      instagram: doc.instagram,
      facebook: doc.facebook,
      youtube: doc.youtube,
      website: doc.website,
      linkedin: doc.linkedin,
      coverPhoto: this.fileView(doc.coverPhoto),
      gallery: this.fileViews(doc.gallery),
      videos: this.fileViews(doc.videos),
      certificates: this.fileViews(doc.certificates),
      awards: this.fileViews(doc.awards),
      createdAt: doc.get('createdAt')?.toISOString?.() ?? null,
    };
  }
}
