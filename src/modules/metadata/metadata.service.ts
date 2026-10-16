import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';

import { Content, ContentDocument } from '../content/schemas/content.schema';
import { CONTENT_DEFAULTS } from './metadata.defaults';
import {
  CONTENT_KEYS,
  CONTENT_LABELS,
  ContentKey,
  FieldSpec,
  METADATA_TYPES,
  MetadataType,
  metadataType,
} from './metadata.registry';

type Row = Record<string, unknown>;

/** What the console needs to draw a type's table and form. */
export interface MetadataTypeView {
  type: string;
  label: string;
  group: string;
  keyField: string;
  keyIsSlug: boolean;
  fields: FieldSpec[];
}

export interface MetadataItemView {
  id: string;
  key: string;
  order: number;
  active: boolean;
  imageUrl: string;
  values: Row;
}

export interface ContentView {
  key: ContentKey;
  label: string;
  /** False when the database has no copy and the built-in default is served. */
  saved: boolean;
  data: Row;
  updatedAt: string | null;
}

const SLUG = /^[a-z0-9][a-z0-9_+-]{0,39}$/;
const MAX_TEXT = 200;
const MAX_LIST = 30;
/** A content document is copy, not a dump — keep it small. */
const MAX_CONTENT_BYTES = 100_000;

/**
 * Validates an admin's input against a type's field list: unknown fields are
 * dropped, every known one is type-checked and trimmed, required ones must be
 * present on create. Returns only what may be written.
 */
export function cleanInput(spec: MetadataType, body: Row, mode: 'create' | 'update'): Row {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestException('Send the fields as an object');
  }
  const out: Row = {};

  // The natural key: required on create, never changed afterwards.
  const rawKey = body[spec.keyField];
  if (mode === 'create') {
    const key = typeof rawKey === 'string' ? rawKey.trim() : '';
    if (!key) throw new BadRequestException(`${spec.keyField} is required`);
    if (spec.keyIsSlug && !SLUG.test(key)) {
      throw new BadRequestException(
        `${spec.keyField} must be lowercase letters, digits, "-" or "_" (e.g. "naming_ceremony")`,
      );
    }
    if (key.length > 60) throw new BadRequestException(`${spec.keyField} is too long`);
    out[spec.keyField] = key;
  } else if (rawKey !== undefined) {
    throw new BadRequestException(
      `${spec.keyField} cannot be changed — other records refer to it. Deactivate this one and add a new one instead.`,
    );
  }

  for (const field of spec.fields) {
    const value = body[field.name];
    if (value === undefined) {
      if (mode === 'create' && field.required) {
        throw new BadRequestException(`${field.label} is required`);
      }
      continue;
    }
    out[field.name] = cleanField(field, value);
  }

  if (body.order !== undefined) {
    const order = Number(body.order);
    if (!Number.isInteger(order) || order < 0 || order > 10_000) {
      throw new BadRequestException('Order must be a whole number from 0');
    }
    out.order = order;
  }
  if (body.active !== undefined) {
    if (typeof body.active !== 'boolean')
      throw new BadRequestException('Active must be true or false');
    out.active = body.active;
  }
  return out;
}

function cleanField(field: FieldSpec, value: unknown): unknown {
  switch (field.kind) {
    case 'text':
    case 'select': {
      if (typeof value !== 'string') throw new BadRequestException(`${field.label} must be text`);
      const text = value.trim();
      if (field.required && !text) throw new BadRequestException(`${field.label} is required`);
      if (text.length > (field.maxLength ?? MAX_TEXT)) {
        throw new BadRequestException(`${field.label} is too long`);
      }
      if (field.kind === 'select' && text && !field.options?.includes(text)) {
        throw new BadRequestException(
          `${field.label} must be one of: ${(field.options ?? []).join(', ')}`,
        );
      }
      return text;
    }
    case 'list': {
      const items = Array.isArray(value)
        ? value
        : typeof value === 'string'
          ? value.split(',')
          : null;
      if (!items) throw new BadRequestException(`${field.label} must be a list`);
      const clean = items
        .map((v) => (typeof v === 'string' ? v.trim().toLowerCase() : ''))
        .filter((v) => v.length > 0 && v.length <= 40);
      return [...new Set(clean)].slice(0, MAX_LIST);
    }
    case 'number': {
      const n = Number(value);
      if (!Number.isFinite(n)) throw new BadRequestException(`${field.label} must be a number`);
      return n;
    }
    case 'boolean':
      if (typeof value !== 'boolean')
        throw new BadRequestException(`${field.label} must be true or false`);
      return value;
    default:
      return undefined;
  }
}

/**
 * Admin management of the app's setup data — the options the planner and
 * organizer registration offer, and the Home/Plan content — plus the public
 * read of all of it in one call.
 *
 * Nothing here deletes: an option other records already point at is retired
 * by deactivating it, which hides it from new choices and leaves every
 * existing plan, organizer and booking that names it intact.
 */
@Injectable()
export class MetadataService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(Content.name) private readonly contentModel: Model<ContentDocument>,
  ) {}

  types(): { types: MetadataTypeView[]; content: Array<{ key: ContentKey; label: string }> } {
    return {
      types: METADATA_TYPES.map(({ type, label, group, keyField, keyIsSlug, fields }) => ({
        type,
        label,
        group,
        keyField,
        keyIsSlug,
        fields,
      })),
      content: CONTENT_KEYS.map((key) => ({ key, label: CONTENT_LABELS[key] })),
    };
  }

  async list(type: string): Promise<MetadataItemView[]> {
    const spec = this.spec(type);
    const docs = await this.model(spec).find().sort({ order: 1, createdAt: 1 }).lean().exec();
    return docs.map((d) => this.view(spec, d as Row));
  }

  async create(type: string, body: Row): Promise<MetadataItemView> {
    const spec = this.spec(type);
    const data = cleanInput(spec, body, 'create');
    const model = this.model(spec);
    if (await model.exists({ [spec.keyField]: data[spec.keyField] })) {
      throw new ConflictException(`"${String(data[spec.keyField])}" already exists`);
    }
    if (data.order === undefined) {
      const last = (await model
        .findOne()
        .sort({ order: -1 })
        .select('order')
        .lean()
        .exec()) as Row | null;
      data.order = typeof last?.order === 'number' ? last.order + 1 : 0;
    }
    try {
      const doc = await model.create(data);
      return this.view(spec, doc.toObject() as Row);
    } catch (err) {
      if ((err as { code?: number })?.code === 11000) {
        throw new ConflictException(`"${String(data[spec.keyField])}" already exists`);
      }
      throw err;
    }
  }

  async update(type: string, id: string, body: Row): Promise<MetadataItemView> {
    const spec = this.spec(type);
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Not found');
    const data = cleanInput(spec, body, 'update');
    if (!Object.keys(data).length) throw new BadRequestException('Nothing to change');
    const doc = await this.model(spec)
      .findByIdAndUpdate(id, { $set: data }, { new: true, runValidators: true })
      .lean()
      .exec();
    if (!doc) throw new NotFoundException('Not found');
    return this.view(spec, doc as Row);
  }

  /**
   * Every active option of every type, in display order — the whole setup in
   * one cacheable call for apps that want it.
   */
  async bootstrap(): Promise<Record<string, Row[]>> {
    const out: Record<string, Row[]> = {};
    await Promise.all(
      METADATA_TYPES.map(async (spec) => {
        const docs = await this.model(spec)
          .find({ active: true })
          .sort({ order: 1, createdAt: 1 })
          .lean()
          .exec();
        out[spec.type] = docs.map((d) => {
          const v = this.view(spec, d as Row);
          return {
            [spec.keyField]: v.key,
            ...v.values,
            ...(v.imageUrl ? { imageUrl: v.imageUrl } : {}),
          };
        });
      }),
    );
    return out;
  }

  /* ------------------------------------------------------------- content */

  async listContent(): Promise<ContentView[]> {
    return Promise.all(CONTENT_KEYS.map((key) => this.getContent(key)));
  }

  async getContent(key: string): Promise<ContentView> {
    const k = this.contentKey(key);
    const doc = await this.contentModel.findOne({ key: k }).lean().exec();
    return {
      key: k,
      label: CONTENT_LABELS[k],
      saved: !!doc,
      data: (doc?.data as Row) ?? CONTENT_DEFAULTS[k],
      updatedAt: (doc as { updatedAt?: Date } | null)?.updatedAt?.toISOString?.() ?? null,
    };
  }

  /** Replaces a content document with the admin's edited copy. */
  async saveContent(key: string, data: unknown): Promise<ContentView> {
    const k = this.contentKey(key);
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new BadRequestException('Content must be a JSON object');
    }
    if (JSON.stringify(data).length > MAX_CONTENT_BYTES) {
      throw new BadRequestException('Content is too large');
    }
    await this.contentModel
      .updateOne({ key: k }, { $set: { key: k, data } }, { upsert: true })
      .exec();
    return this.getContent(k);
  }

  /** Writes the built-in default as the saved copy (undoes every edit). */
  async resetContent(key: string): Promise<ContentView> {
    const k = this.contentKey(key);
    return this.saveContent(k, CONTENT_DEFAULTS[k]);
  }

  /* ------------------------------------------------------------- helpers */

  private spec(type: string): MetadataType {
    const spec = metadataType(type);
    if (!spec) throw new NotFoundException(`Unknown setup type "${type}"`);
    return spec;
  }

  private model(spec: MetadataType): Model<Row> {
    return this.connection.model<Row>(spec.modelName);
  }

  private contentKey(key: string): ContentKey {
    if (!(CONTENT_KEYS as readonly string[]).includes(key)) {
      throw new NotFoundException(`Unknown content "${key}"`);
    }
    return key as ContentKey;
  }

  private view(spec: MetadataType, d: Row): MetadataItemView {
    const values: Row = {};
    for (const f of spec.fields) values[f.name] = d[f.name] ?? (f.kind === 'list' ? [] : '');
    const image = d.image as { url?: string } | null | undefined;
    return {
      id: String(d._id),
      key: String(d[spec.keyField] ?? ''),
      order: typeof d.order === 'number' ? d.order : 0,
      active: d.active !== false,
      imageUrl: image?.url ?? '',
      values,
    };
  }
}
