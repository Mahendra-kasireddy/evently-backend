import { BusinessType, BusinessTypeSchema } from '../organizer/schemas/business-type.schema';
import {
  OrganizerCategory,
  OrganizerCategorySchema,
} from '../organizer/schemas/organizer-category.schema';
import {
  DocumentType,
  DocumentTypeSchema,
  ExperienceRange,
  ExperienceRangeSchema,
  Language,
  LanguageSchema,
  PaymentMethod,
  PaymentMethodSchema,
  TeamSize,
  TeamSizeSchema,
  TravelOption,
  TravelOptionSchema,
  WorkingDay,
  WorkingDaySchema,
} from '../organizer/schemas/services-config.schema';
import { PlanBudgetRange, PlanBudgetRangeSchema } from '../plan/schemas/plan-budget-range.schema';
import { PlanCity, PlanCitySchema } from '../plan/schemas/plan-city.schema';
import { PlanGuestRange, PlanGuestRangeSchema } from '../plan/schemas/plan-guest-range.schema';
import { PlanOccasion, PlanOccasionSchema } from '../plan/schemas/plan-occasion.schema';
import {
  PlanServiceCategory,
  PlanServiceCategorySchema,
} from '../plan/schemas/plan-service-category.schema';
import {
  businessTypes,
  documentTypes,
  experienceRanges,
  languages,
  organizerCategories,
  paymentMethods,
  planBudgetRanges,
  planCities,
  planGuestRanges,
  planOccasions,
  planServiceCategories,
  teamSizes,
  travelOptions,
  workingDays,
} from './metadata.defaults';

/**
 * Every kind of setup data an admin manages, in one table: where it lives,
 * what identifies it, and which fields may be edited.
 *
 * The data itself stays in its own typed collection (validated by its own
 * schema, indexed on its own key) — this only describes it, so the admin API
 * and console can manage all of them the same way. Adding a kind is one entry
 * here; nothing else needs to learn about it.
 */

export type FieldKind = 'text' | 'number' | 'boolean' | 'list' | 'select';

export interface FieldSpec {
  name: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  maxLength?: number;
  /** For `select`: the only values the apps know how to show. */
  options?: string[];
  hint?: string;
}

export interface MetadataType {
  /** URL-safe id used by the admin API (`/admin/metadata/:type`). */
  type: string;
  label: string;
  group: 'Planner' | 'Organizer registration';
  modelName: string;
  schema: unknown;
  collection: string;
  /**
   * The natural key other records refer to ("wedding", "Hyderabad"). Set once
   * at creation and never changed — organizers, plans and bookings already
   * store it. Retire an option by deactivating it instead.
   */
  keyField: 'key' | 'name' | 'value';
  /** Keys are machine ids (lowercase slug); names/values are display text. */
  keyIsSlug: boolean;
  /** Editable fields besides the key, `order` and `active`. */
  fields: FieldSpec[];
  /** The built-in starting set, for `seed:config`. */
  defaults: Array<Record<string, unknown>>;
}

const label = (max = 80): FieldSpec => ({
  name: 'label',
  label: 'Label',
  kind: 'text',
  required: true,
  maxLength: max,
});

/** Just a key and a label — most organizer-registration options. */
const simple = (
  type: string,
  title: string,
  modelName: string,
  schema: unknown,
  collection: string,
  defaults: Array<Record<string, unknown>>,
): MetadataType => ({
  type,
  label: title,
  group: 'Organizer registration',
  modelName,
  schema,
  collection,
  keyField: 'key',
  keyIsSlug: true,
  fields: [label()],
  defaults,
});

/** The art keys and icon names the web and mobile apps can draw. */
const OCCASION_ART = ['wedding', 'birthday', 'housewarming', 'naming', 'anniversary', 'corporate'];
const SERVICE_ICONS = [
  'food',
  'water',
  'decor',
  'photo',
  'music',
  'priest',
  'mehendi',
  'transport',
];
const ORGANIZER_ICONS = [
  'heart',
  'sparkles',
  'utensils',
  'camera',
  'briefcase',
  'gift',
  'building',
];

export const METADATA_TYPES: MetadataType[] = [
  {
    type: 'occasions',
    label: 'Occasions',
    group: 'Planner',
    modelName: PlanOccasion.name,
    schema: PlanOccasionSchema,
    collection: 'plan_occasions',
    keyField: 'key',
    keyIsSlug: true,
    fields: [
      label(40),
      {
        name: 'art',
        label: 'Illustration',
        kind: 'select',
        required: true,
        options: OCCASION_ART,
        hint: 'Shown when the occasion has no photo.',
      },
    ],
    defaults: planOccasions,
  },
  {
    type: 'cities',
    label: 'Cities',
    group: 'Planner',
    modelName: PlanCity.name,
    schema: PlanCitySchema,
    collection: 'plan_cities',
    keyField: 'name',
    keyIsSlug: false,
    fields: [],
    defaults: planCities,
  },
  {
    type: 'guest-ranges',
    label: 'Guest counts',
    group: 'Planner',
    modelName: PlanGuestRange.name,
    schema: PlanGuestRangeSchema,
    collection: 'plan_guest_ranges',
    keyField: 'value',
    keyIsSlug: false,
    fields: [],
    defaults: planGuestRanges,
  },
  {
    type: 'budget-ranges',
    label: 'Budget ranges',
    group: 'Planner',
    modelName: PlanBudgetRange.name,
    schema: PlanBudgetRangeSchema,
    collection: 'plan_budget_ranges',
    keyField: 'value',
    keyIsSlug: false,
    fields: [],
    defaults: planBudgetRanges,
  },
  {
    type: 'service-categories',
    label: 'Service categories',
    group: 'Planner',
    modelName: PlanServiceCategory.name,
    schema: PlanServiceCategorySchema,
    collection: 'plan_service_categories',
    keyField: 'key',
    keyIsSlug: true,
    fields: [
      { name: 'title', label: 'Title', kind: 'text', required: true, maxLength: 60 },
      { name: 'subtitle', label: 'Subtitle', kind: 'text', maxLength: 80 },
      { name: 'icon', label: 'Icon', kind: 'select', required: true, options: SERVICE_ICONS },
      {
        name: 'keywords',
        label: 'Matching keywords',
        kind: 'list',
        hint: 'Comma-separated. Organizers whose services mention one of these are matched.',
      },
    ],
    defaults: planServiceCategories,
  },
  {
    type: 'business-types',
    label: 'Business types',
    group: 'Organizer registration',
    modelName: BusinessType.name,
    schema: BusinessTypeSchema,
    collection: 'business_types',
    keyField: 'key',
    keyIsSlug: true,
    fields: [label()],
    defaults: businessTypes,
  },
  {
    type: 'organizer-categories',
    label: 'Organizer categories',
    group: 'Organizer registration',
    modelName: OrganizerCategory.name,
    schema: OrganizerCategorySchema,
    collection: 'organizer_categories',
    keyField: 'key',
    keyIsSlug: true,
    fields: [label(), { name: 'icon', label: 'Icon', kind: 'select', options: ORGANIZER_ICONS }],
    defaults: organizerCategories,
  },
  simple(
    'experience-ranges',
    'Experience ranges',
    ExperienceRange.name,
    ExperienceRangeSchema,
    'experience_ranges',
    experienceRanges,
  ),
  simple('team-sizes', 'Team sizes', TeamSize.name, TeamSizeSchema, 'team_sizes', teamSizes),
  simple('languages', 'Languages', Language.name, LanguageSchema, 'languages', languages),
  simple(
    'travel-options',
    'Travel options',
    TravelOption.name,
    TravelOptionSchema,
    'travel_options',
    travelOptions,
  ),
  simple(
    'payment-methods',
    'Payment methods',
    PaymentMethod.name,
    PaymentMethodSchema,
    'payment_methods',
    paymentMethods,
  ),
  simple(
    'working-days',
    'Working days',
    WorkingDay.name,
    WorkingDaySchema,
    'working_days',
    workingDays,
  ),
  simple(
    'document-types',
    'ID document types',
    DocumentType.name,
    DocumentTypeSchema,
    'document_types',
    documentTypes,
  ),
];

export function metadataType(type: string): MetadataType | undefined {
  return METADATA_TYPES.find((t) => t.type === type);
}

/** The content documents an admin may edit (see CONTENT_DEFAULTS). */
export const CONTENT_KEYS = ['customer-home', 'customer-plan'] as const;
export type ContentKey = (typeof CONTENT_KEYS)[number];

export const CONTENT_LABELS: Record<ContentKey, string> = {
  'customer-home': 'Home screen',
  'customer-plan': 'Plan an event',
};
