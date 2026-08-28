/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Sub-vendor onboarding — the "Other" category rules, over real HTTP.
 *
 * Boots the real SubvendorController with the real global ValidationPipe and
 * the real JwtAuthGuard, so the conditional DTO validation is exercised as the
 * server actually applies it. Only the database is substituted.
 *
 * Run: npx ts-node scripts/verify-subvendor-onboard.ts
 */
import 'reflect-metadata';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';

import { SubvendorController } from '../src/modules/subvendor/subvendor.controller';
import { SubvendorService } from '../src/modules/subvendor/subvendor.service';
import { SubVendorProfile } from '../src/modules/subvendor/schemas/subvendor-profile.schema';
import { SubVendorLink } from '../src/modules/subvendor/schemas/subvendor-link.schema';
import { UserService } from '../src/modules/user/user.service';
import { OrganizerService } from '../src/modules/organizer/organizer.service';
import { AuthService } from '../src/modules/auth/auth.service';
import { NotificationService } from '../src/modules/notification/notification.service';
import { JwtStrategy } from '../src/modules/auth/strategies/jwt.strategy';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';

const SECRET = 'verification-only-secret-not-a-real-one-0123456789';

const created: any[] = [];
/** Set to a profile document to simulate "this user already has one". */
let existingProfile: any = null;
const profiles: any = {
  findOne: (filter: any) => ({
    exec: async () =>
      existingProfile && String(existingProfile.user) === String(filter?.user)
        ? existingProfile
        : null,
  }),
  create: async (data: any) => {
    const d = { ...data, _id: new Types.ObjectId(), save: async () => d };
    created.push(d);
    return d;
  },
};
const links: any = {
  updateMany: () => ({ exec: async () => ({}) }),
  findOne: () => ({ exec: async () => null }),
  create: async (d: any) => d,
  find: () => ({ populate: () => ({ sort: () => ({ exec: async () => [] }) }), exec: async () => [] }),
};

let passed = 0, failed = 0;
const check = (n: string, ok: boolean, d = '') => {
  if (ok) { passed++; console.log(`  PASS  ${n}`); }
  else { failed++; console.log(`  FAIL  ${n}${d ? ` — ${d}` : ''}`); }
};

async function main() {
  process.env.JWT_ACCESS_SECRET = SECRET;
  const userId = new Types.ObjectId();

  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [() => ({ jwt: { accessSecret: SECRET } })] }),
      PassportModule,
      JwtModule.register({ secret: SECRET }),
    ],
    controllers: [SubvendorController],
    providers: [
      SubvendorService, JwtStrategy,
      { provide: APP_GUARD, useClass: JwtAuthGuard },
      { provide: getModelToken(SubVendorProfile.name), useValue: profiles },
      { provide: getModelToken(SubVendorLink.name), useValue: links },
      { provide: UserService, useValue: { addRole: async () => ({ _id: userId, name: 'Anil', phone: '' }) } },
      { provide: OrganizerService, useValue: { findByUser: async () => null, findByPhone: async () => null } },
      { provide: AuthService, useValue: { issueSessionForUser: async () => ({ accessToken: 't', refreshToken: 'r' }) } },
      { provide: NotificationService, useValue: { create: async () => ({}) } },
    ],
  }).compile();

  const app: INestApplication = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(0);
  const base = `${await app.getUrl()}/api`.replace('[::1]', '127.0.0.1');

  const jwt = app.get(JwtService);
  // Onboarding is reached before the VENDOR role exists, so this caller is a
  // plain customer — which is exactly the state /subvendor/onboard must accept.
  const token = jwt.sign({ sub: userId.toString(), roles: ['customer'] }, { secret: SECRET });
  // Editing a profile happens after onboarding granted the VENDOR role.
  const vendorToken = jwt.sign({ sub: userId.toString(), roles: ['vendor'] }, { secret: SECRET });
  const post = async (body: any) => {
    const res = await fetch(`${base}/subvendor/onboard`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let json: any = null;
    if (text) { try { json = JSON.parse(text); } catch { /* non-JSON */ } }
    return { status: res.status, json };
  };

  console.log('\nCUSTOM CATEGORY VALIDATION');

  const base1 = { fullName: 'Anil Balloons', serviceArea: 'Gachibowli' };

  const noCustom = await post({ ...base1, categoryId: 'other' });
  check('"other" without a label is rejected', noCustom.status === 400, `status ${noCustom.status}`);
  check('the error names what to do',
    /couple of words|customCategory/i.test(JSON.stringify(noCustom.json?.message ?? '')),
    JSON.stringify(noCustom.json?.message));

  const shortCustom = await post({ ...base1, categoryId: 'other', customCategory: 'x' });
  check('a one-character label is rejected', shortCustom.status === 400);

  const longCustom = await post({ ...base1, categoryId: 'other', customCategory: 'x'.repeat(61) });
  check('an over-long label is rejected', longCustom.status === 400);

  const bogus = await post({ ...base1, categoryId: 'balloon-artist' });
  check('a free-text category is still rejected — the enum holds',
    bogus.status === 400, `status ${bogus.status}`);

  console.log('\nWHAT GETS STORED');

  created.length = 0;
  const ok = await post({ ...base1, categoryId: 'other', customCategory: '  Balloon artist  ' });
  check('"other" with a label is accepted', ok.status === 201, `status ${ok.status}`);
  const doc = created[0];
  check('the enum value is stored', doc?.category === 'other');
  check('the label is stored, trimmed', doc?.customCategory === 'Balloon artist',
    JSON.stringify(doc?.customCategory));
  check('it starts as an unresolved request', doc?.customCategoryResolved === false);
  check('an unknown trade gets the generic unit, not an invented one',
    doc?.baseRateUnit === 'job', String(doc?.baseRateUnit));

  created.length = 0;
  const real = await post({ ...base1, categoryId: 'food', customCategory: 'Balloon artist' });
  check('a real category is accepted', real.status === 201);
  check('a stray label is discarded for a real category — the two can never disagree',
    created[0]?.customCategory === '', JSON.stringify(created[0]?.customCategory));
  check('a real category keeps its own unit', created[0]?.baseRateUnit === 'plate');

  console.log('\nPROFILE EDITING');

  check(
    'a customer without the vendor role cannot edit a vendor profile',
    (await (async () => {
      const res = await fetch(`${base}/subvendor/profile`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ baseRate: 1 }),
      });
      return res.status;
    })()) === 403,
  );
  check(
    'an anonymous caller cannot edit a vendor profile',
    (await (async () => {
      const res = await fetch(`${base}/subvendor/profile`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseRate: 1 }),
      });
      return res.status;
    })()) === 401,
  );

  const patch = async (body: any, bearer = vendorToken) => {
    const res = await fetch(`${base}/subvendor/profile`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
      body: JSON.stringify(body),
    });
    const t = await res.text();
    let json: any = null;
    if (t) { try { json = JSON.parse(t); } catch { /* non-JSON */ } }
    return { status: res.status, json };
  };

  // No profile yet for this user.
  existingProfile = null;
  const orphan = await patch({ baseRate: 500 });
  check('a user with no vendor profile is refused', orphan.status === 403, `status ${orphan.status}`);

  // Give the caller a profile.
  const saved: any[] = [];
  existingProfile = {
    _id: new Types.ObjectId(),
    user: userId,
    fullName: 'Anil Balloons',
    initials: 'AB',
    avatarColor: '#e8633a',
    category: 'other',
    customCategory: 'Balloon artist',
    serviceArea: 'Gachibowli',
    baseRate: 3000,
    baseRateUnit: 'job',
    minOrder: 0,
    active: true,
    save: async () => { saved.push({ ...existingProfile }); return existingProfile; },
  };

  const okEdit = await patch({ serviceArea: '  Kukatpally  ', baseRate: 4500, minOrder: 2 });
  check('a vendor can edit their own rate card', okEdit.status === 200, `status ${okEdit.status}`);
  check('service area is trimmed', existingProfile.serviceArea === 'Kukatpally',
    JSON.stringify(existingProfile.serviceArea));
  check('the new rate is stored', existingProfile.baseRate === 4500);
  check('the response carries the updated profile', okEdit.json?.baseRate === 4500);
  check('availability is exposed to the client', okEdit.json?.active === true);

  const away = await patch({ active: false });
  check('a vendor can take themselves off the roster', existingProfile.active === false,
    String(existingProfile.active));
  check('the response reflects it', away.json?.active === false);

  console.log('\nWHAT A VENDOR MAY NOT CHANGE');

  const beforeCat = existingProfile.category;
  const beforeName = existingProfile.fullName;
  const strip = await patch({ category: 'food', fullName: 'Someone Else', baseRate: 100 });
  check('the request still succeeds', strip.status === 200);
  check('category is stripped — it drives pricing and matching',
    existingProfile.category === beforeCat, String(existingProfile.category));
  check('name is stripped', existingProfile.fullName === beforeName, String(existingProfile.fullName));
  check('the declared field still applied', existingProfile.baseRate === 100);

  console.log('\nVALIDATION');

  check('a negative rate is rejected', (await patch({ baseRate: -1 })).status === 400);
  check('an absurd rate is rejected', (await patch({ baseRate: 99_000_000 })).status === 400);
  check('a fractional rate is rejected', (await patch({ baseRate: 12.5 })).status === 400);
  check('an over-long service area is rejected',
    (await patch({ serviceArea: 'x'.repeat(121) })).status === 400);
  check('a non-boolean availability is rejected', (await patch({ active: 'maybe' })).status === 400);
  check('an empty patch is accepted and changes nothing',
    (await patch({})).status === 200);

  await app.close();
  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}
void main();
