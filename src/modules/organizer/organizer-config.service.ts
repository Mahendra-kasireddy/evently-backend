import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { BusinessType, BusinessTypeDocument } from './schemas/business-type.schema';
import { OrganizerCategory, OrganizerCategoryDocument } from './schemas/organizer-category.schema';
import {
  ExperienceRange,
  ExperienceRangeDocument,
  TeamSize,
  TeamSizeDocument,
  Language,
  LanguageDocument,
  TravelOption,
  TravelOptionDocument,
  PaymentMethod,
  PaymentMethodDocument,
  WorkingDay,
  WorkingDayDocument,
  DocumentType,
  DocumentTypeDocument,
} from './schemas/services-config.schema';
import { PlanCityDocument } from '../plan/schemas/plan-city.schema';
import { PlanOccasionDocument } from '../plan/schemas/plan-occasion.schema';
import { PlanServiceCategoryDocument } from '../plan/schemas/plan-service-category.schema';

/** Injection tokens for reused plan_* collections (read-only here, no duplication). */
export const CITY_REF_MODEL = 'OrganizerCityRef';
export const OCCASION_REF_MODEL = 'OrganizerOccasionRef';
export const SERVICE_CATEGORY_REF_MODEL = 'OrganizerServiceCategoryRef';

export interface OptionView {
  key: string;
  label: string;
}

export interface OnboardingConfig {
  businessTypes: OptionView[];
  categories: OptionView[];
  cities: string[];
}

export interface ServicesConfig {
  experienceRanges: OptionView[];
  teamSizes: OptionView[];
  languages: OptionView[];
  travelOptions: OptionView[];
  paymentMethods: OptionView[];
  workingDays: OptionView[];
  documentTypes: OptionView[];
  categories: OptionView[];
  occasions: OptionView[];
  serviceCategories: OptionView[];
}

/**
 * Serves the dynamic dropdown data for organizer onboarding from MongoDB —
 * nothing is hardcoded. Step 1 config (business types, categories, cities) and
 * Step 4 config (experience, team size, languages, travel, payment, working
 * days, document types, occasions, service categories). Cities/occasions/service
 * categories reuse existing plan_* collections via distinct read-model tokens.
 */
@Injectable()
export class OrganizerConfigService {
  constructor(
    @InjectModel(BusinessType.name)
    private readonly businessTypeModel: Model<BusinessTypeDocument>,
    @InjectModel(OrganizerCategory.name)
    private readonly categoryModel: Model<OrganizerCategoryDocument>,
    @InjectModel(ExperienceRange.name)
    private readonly experienceModel: Model<ExperienceRangeDocument>,
    @InjectModel(TeamSize.name)
    private readonly teamSizeModel: Model<TeamSizeDocument>,
    @InjectModel(Language.name)
    private readonly languageModel: Model<LanguageDocument>,
    @InjectModel(TravelOption.name)
    private readonly travelModel: Model<TravelOptionDocument>,
    @InjectModel(PaymentMethod.name)
    private readonly paymentModel: Model<PaymentMethodDocument>,
    @InjectModel(WorkingDay.name)
    private readonly workingDayModel: Model<WorkingDayDocument>,
    @InjectModel(DocumentType.name)
    private readonly documentTypeModel: Model<DocumentTypeDocument>,
    @InjectModel(CITY_REF_MODEL)
    private readonly cityModel: Model<PlanCityDocument>,
    @InjectModel(OCCASION_REF_MODEL)
    private readonly occasionModel: Model<PlanOccasionDocument>,
    @InjectModel(SERVICE_CATEGORY_REF_MODEL)
    private readonly serviceCategoryModel: Model<PlanServiceCategoryDocument>,
  ) {}

  // Mongoose models are invariant in their document type, so a single helper
  // that serves every key/label collection uses a loose model type.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async options(model: Model<any>): Promise<OptionView[]> {
    const docs = await model.find({ active: true }).sort({ order: 1, label: 1 }).exec();
    return (docs as Array<{ key: string; label: string }>).map((d) => ({
      key: d.key,
      label: d.label,
    }));
  }

  async getBusinessTypes(): Promise<OptionView[]> {
    return this.options(this.businessTypeModel);
  }

  async getCategories(): Promise<OptionView[]> {
    return this.options(this.categoryModel);
  }

  async getCities(): Promise<string[]> {
    const docs = await this.cityModel.find({ active: true }).sort({ order: 1, name: 1 }).exec();
    return docs.map((d) => d.name);
  }

  /** Aggregated Step 1 config — one round-trip for the client. */
  async getOnboardingConfig(): Promise<OnboardingConfig> {
    const [businessTypes, categories, cities] = await Promise.all([
      this.getBusinessTypes(),
      this.getCategories(),
      this.getCities(),
    ]);
    return { businessTypes, categories, cities };
  }

  /** Aggregated Step 4 config — one round-trip for the services step. */
  async getServicesConfig(): Promise<ServicesConfig> {
    const [
      experienceRanges,
      teamSizes,
      languages,
      travelOptions,
      paymentMethods,
      workingDays,
      documentTypes,
      categories,
      occasionDocs,
      serviceCategoryDocs,
    ] = await Promise.all([
      this.options(this.experienceModel),
      this.options(this.teamSizeModel),
      this.options(this.languageModel),
      this.options(this.travelModel),
      this.options(this.paymentModel),
      this.options(this.workingDayModel),
      this.options(this.documentTypeModel),
      this.getCategories(),
      this.occasionModel.find({ active: true }).sort({ order: 1, label: 1 }).exec(),
      this.serviceCategoryModel.find({ active: true }).sort({ order: 1, title: 1 }).exec(),
    ]);
    return {
      experienceRanges,
      teamSizes,
      languages,
      travelOptions,
      paymentMethods,
      workingDays,
      documentTypes,
      categories,
      occasions: occasionDocs.map((o) => ({ key: o.key, label: o.label })),
      serviceCategories: serviceCategoryDocs.map((c) => ({ key: c.key, label: c.title })),
    };
  }

  // Existence checks used when a profile is submitted for verification.
  async businessTypeExists(key: string): Promise<boolean> {
    return (await this.businessTypeModel.exists({ key, active: true })) != null;
  }

  async categoryExists(key: string): Promise<boolean> {
    return (await this.categoryModel.exists({ key, active: true })) != null;
  }

  async cityExists(name: string): Promise<boolean> {
    return (await this.cityModel.exists({ name, active: true })) != null;
  }
}
