import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { ContentService } from '../content/content.service';
import { PlanOccasion, PlanOccasionDocument } from './schemas/plan-occasion.schema';
import { PlanCity, PlanCityDocument } from './schemas/plan-city.schema';
import { PlanGuestRange, PlanGuestRangeDocument } from './schemas/plan-guest-range.schema';
import { PlanBudgetRange, PlanBudgetRangeDocument } from './schemas/plan-budget-range.schema';
import {
  PlanServiceCategory,
  PlanServiceCategoryDocument,
} from './schemas/plan-service-category.schema';

/** Content key holding the Plan Event copy/config (non-list CMS fields). */
export const CUSTOMER_PLAN_KEY = 'customer-plan';

export interface PlanOccasionView {
  id: string;
  label: string;
  art: string;
}
export interface PlanServiceCategoryView {
  id: string;
  title: string;
  subtitle: string;
  icon: string;
}

/**
 * Assembles the Plan Event wizard config. List data (occasions, cities, guest
 * ranges, service categories) comes from normalized collections; the remaining
 * copy (steps, trust, ideas, filters, banners…) comes from the CMS content blob.
 * The composed shape is byte-compatible with what the client already consumes.
 */
@Injectable()
export class PlanConfigService {
  constructor(
    private readonly contentService: ContentService,
    @InjectModel(PlanOccasion.name)
    private readonly occasionModel: Model<PlanOccasionDocument>,
    @InjectModel(PlanCity.name)
    private readonly cityModel: Model<PlanCityDocument>,
    @InjectModel(PlanGuestRange.name)
    private readonly guestRangeModel: Model<PlanGuestRangeDocument>,
    @InjectModel(PlanBudgetRange.name)
    private readonly budgetRangeModel: Model<PlanBudgetRangeDocument>,
    @InjectModel(PlanServiceCategory.name)
    private readonly serviceCategoryModel: Model<PlanServiceCategoryDocument>,
  ) {}

  async getOccasions(): Promise<PlanOccasionView[]> {
    const docs = await this.occasionModel
      .find({ active: true })
      .sort({ order: 1, label: 1 })
      .exec();
    return docs.map((o) => ({ id: o.key, label: o.label, art: o.art }));
  }

  async getCities(): Promise<string[]> {
    const docs = await this.cityModel.find({ active: true }).sort({ order: 1, name: 1 }).exec();
    return docs.map((c) => c.name);
  }

  async getGuestRanges(): Promise<string[]> {
    const docs = await this.guestRangeModel.find({ active: true }).sort({ order: 1 }).exec();
    return docs.map((g) => g.value);
  }

  async getBudgetRanges(): Promise<string[]> {
    const docs = await this.budgetRangeModel.find({ active: true }).sort({ order: 1 }).exec();
    return docs.map((b) => b.value);
  }

  async getServiceCategories(): Promise<PlanServiceCategoryView[]> {
    const docs = await this.serviceCategoryModel
      .find({ active: true })
      .sort({ order: 1, title: 1 })
      .exec();
    return docs.map((c) => ({
      id: c.key,
      title: c.title,
      subtitle: c.subtitle,
      icon: c.icon,
    }));
  }

  /** Full wizard screen payload (aggregated — one request for the whole screen). */
  async getPlanScreen(): Promise<Record<string, unknown>> {
    const [copy, occasions, cityOptions, guestOptions, budgetOptions, categories] =
      await Promise.all([
        this.contentService.getData(CUSTOMER_PLAN_KEY),
        this.getOccasions(),
        this.getCities(),
        this.getGuestRanges(),
        this.getBudgetRanges(),
        this.getServiceCategories(),
      ]);

    return {
      ...copy,
      occasions,
      cityOptions,
      guestOptions,
      budgetOptions,
      categories,
    };
  }
}
