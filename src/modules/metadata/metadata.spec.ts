import { BadRequestException, ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Types } from 'mongoose';
import type { Connection, Model } from 'mongoose';

import { cleanInput, MetadataService } from './metadata.service';
import { METADATA_TYPES, metadataType } from './metadata.registry';
import { CONTENT_DEFAULTS, customerHomeContent } from './metadata.defaults';
import { ContentService } from '../content/content.service';
import type { ContentDocument } from '../content/schemas/content.schema';

type Doc = Record<string, any>;

const exec = <T>(v: T) => {
  const q = { exec: () => Promise.resolve(v), lean: () => q, select: () => q, sort: () => q };
  return q;
};

/** An in-memory stand-in for one config collection's Mongoose model. */
function fakeModel(seed: Doc[] = []) {
  const docs: Doc[] = seed.map((d) => ({ _id: new Types.ObjectId(), ...d }));
  const match = (d: Doc, f: Doc) => Object.entries(f).every(([k, v]) => d[k] === v);
  return {
    docs,
    find: (f: Doc = {}) => {
      const rows = docs.filter((d) => match(d, f)).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      return exec(rows);
    },
    findOne: () => exec([...docs].sort((a, b) => (b.order ?? 0) - (a.order ?? 0))[0] ?? null),
    exists: (f: Doc) => Promise.resolve(docs.some((d) => match(d, f)) ? { _id: 1 } : null),
    create: (data: Doc) => {
      const doc = { _id: new Types.ObjectId(), active: true, ...data };
      docs.push(doc);
      return Promise.resolve({ toObject: () => doc });
    },
    findByIdAndUpdate: (id: string, update: { $set: Doc }) => {
      const doc = docs.find((d) => String(d._id) === id);
      if (doc) Object.assign(doc, update.$set);
      return exec(doc ?? null);
    },
  };
}

function serviceWith(models: Record<string, ReturnType<typeof fakeModel>>, content: Doc[] = []) {
  const connection = {
    model: (name: string) => models[name] ?? (models[name] = fakeModel()),
  } as unknown as Connection;
  const contentModel = {
    findOne: (f: Doc) => exec(content.find((c) => c.key === f.key) ?? null),
    updateOne: (f: Doc, u: { $set: Doc }) => {
      const hit = content.find((c) => c.key === f.key);
      if (hit) Object.assign(hit, u.$set);
      else content.push({ ...u.$set, updatedAt: new Date() });
      return exec({});
    },
  } as unknown as Model<ContentDocument>;
  return { service: new MetadataService(connection, contentModel), content };
}

const occasions = metadataType('occasions')!;
const cities = metadataType('cities')!;
const categories = metadataType('service-categories')!;

describe('input validation', () => {
  it('requires the natural key and required fields on create', () => {
    expect(() => cleanInput(occasions, { label: 'Wedding', art: 'wedding' }, 'create')).toThrow(
      /key is required/,
    );
    expect(() => cleanInput(occasions, { key: 'wedding', art: 'wedding' }, 'create')).toThrow(
      /Label is required/,
    );
  });

  it('keeps machine keys as clean slugs, but allows display text for names', () => {
    expect(() =>
      cleanInput(occasions, { key: 'Naming Ceremony', label: 'x', art: 'naming' }, 'create'),
    ).toThrow(/lowercase/);
    expect(cleanInput(cities, { name: '  Vijayawada ' }, 'create')).toEqual({ name: 'Vijayawada' });
  });

  it('never lets the key change after creation', () => {
    expect(() => cleanInput(occasions, { key: 'other' }, 'update')).toThrow(/cannot be changed/);
  });

  it('drops unknown fields, so nothing else can be written', () => {
    const out = cleanInput(
      occasions,
      {
        key: 'puja',
        label: 'Puja',
        art: 'naming',
        image: { url: 'x' },
        $where: '1',
        roles: ['admin'],
      },
      'create',
    );
    expect(out).toEqual({ key: 'puja', label: 'Puja', art: 'naming' });
  });

  it('only accepts icons and illustrations the apps can draw', () => {
    expect(() =>
      cleanInput(occasions, { key: 'puja', label: 'Puja', art: 'rocket' }, 'create'),
    ).toThrow(/must be one of/);
  });

  it('cleans keyword lists from a comma-separated string', () => {
    const out = cleanInput(categories, { keywords: ' DJ, sound,,dj ' }, 'update');
    expect(out).toEqual({ keywords: ['dj', 'sound'] });
  });

  it('checks order and active', () => {
    expect(() => cleanInput(cities, { order: -1 }, 'update')).toThrow(BadRequestException);
    expect(() => cleanInput(cities, { active: 'yes' }, 'update')).toThrow(BadRequestException);
    expect(cleanInput(cities, { active: false, order: 3 }, 'update')).toEqual({
      active: false,
      order: 3,
    });
  });
});

describe('MetadataService', () => {
  it('creates an option at the end of the list', async () => {
    const model = fakeModel([{ name: 'Hyderabad', order: 0, active: true }]);
    const { service } = serviceWith({ [cities.modelName]: model });
    const created = await service.create('cities', { name: 'Vijayawada' });
    expect(created).toMatchObject({ key: 'Vijayawada', order: 1, active: true });
  });

  it('refuses a duplicate', async () => {
    const model = fakeModel([{ name: 'Hyderabad', order: 0 }]);
    const { service } = serviceWith({ [cities.modelName]: model });
    await expect(service.create('cities', { name: 'Hyderabad' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('deactivates instead of deleting', async () => {
    const model = fakeModel([{ name: 'Pune', order: 0, active: true }]);
    const { service } = serviceWith({ [cities.modelName]: model });
    const [pune] = await service.list('cities');
    const updated = await service.update('cities', pune.id, { active: false });
    expect(updated.active).toBe(false);
    expect(model.docs).toHaveLength(1);
  });

  it('rejects an unknown type and a bad id', async () => {
    const { service } = serviceWith({});
    await expect(service.list('users')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.update('cities', 'nope', { active: false })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('bootstrap returns only active options, by their keys', async () => {
    const { service } = serviceWith({
      [cities.modelName]: fakeModel([
        { name: 'Hyderabad', order: 0, active: true },
        { name: 'Old City', order: 1, active: false },
      ]),
    });
    const all = await service.bootstrap();
    expect(all.cities).toEqual([{ name: 'Hyderabad' }]);
    expect(Object.keys(all)).toEqual(expect.arrayContaining(METADATA_TYPES.map((t) => t.type)));
  });

  it('shows the built-in content until an admin saves a copy, then the copy', async () => {
    const { service } = serviceWith({});
    const before = await service.getContent('customer-home');
    expect(before).toMatchObject({ saved: false, data: customerHomeContent });

    const edited = { ...customerHomeContent, greeting: 'Welcome to Hypie' };
    const after = await service.saveContent('customer-home', edited);
    expect(after).toMatchObject({ saved: true, data: edited });
  });

  it('only edits known content, and only as an object', async () => {
    const { service } = serviceWith({});
    await expect(service.saveContent('secrets', {})).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.saveContent('customer-home', ['x'])).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('built-in defaults', () => {
  it('every default is valid input for its own type, with a unique key', () => {
    for (const spec of METADATA_TYPES) {
      const keys = spec.defaults.map((d) => d[spec.keyField]);
      expect(new Set(keys).size).toBe(keys.length);
      for (const d of spec.defaults) {
        expect(() => cleanInput(spec, d, 'create')).not.toThrow();
      }
    }
  });

  it('ships no sample businesses, packages or users', () => {
    const text = readFileSync(join(__dirname, 'metadata.defaults.ts'), 'utf8');
    expect(text).not.toMatch(/phone:|organizerId|Mangala|Concierge|perGuest/);
  });
});

describe('content fallback', () => {
  const content = (doc: Doc | null) =>
    new ContentService({ findOne: () => exec(doc) } as never, {} as never, {} as never);

  beforeEach(() => jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined));
  afterEach(() => jest.restoreAllMocks());

  it('serves the saved copy when there is one', async () => {
    await expect(content({ data: { a: 1 } }).getData('customer-home')).resolves.toEqual({ a: 1 });
  });

  it('serves the built-in default on an empty database instead of failing', async () => {
    await expect(content(null).getData('customer-home')).resolves.toBe(
      CONTENT_DEFAULTS['customer-home'],
    );
    await expect(content(null).getData('customer-plan')).resolves.toBe(
      CONTENT_DEFAULTS['customer-plan'],
    );
  });

  it('is still a 404 for a key with no default', async () => {
    await expect(content(null).getData('nope')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('seed scripts', () => {
  const read = (f: string) => readFileSync(join(__dirname, '..', '..', '..', 'scripts', f), 'utf8');

  it('seed:config only inserts — it never overwrites or deletes', () => {
    const text = read('seed-config.ts');
    expect(text).toMatch(/\$setOnInsert/);
    expect(text).not.toMatch(/\$set:|deleteMany|deleteOne|drop\(/);
  });

  it('the demo seed refuses production and needs --yes', () => {
    const text = read('seed.ts');
    expect(text).toMatch(/NODE_ENV === 'production'/);
    expect(text).toMatch(/--yes/);
  });
});
