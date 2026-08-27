/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Admin Users — verification over real HTTP.
 *
 * Boots the real AdminUserController, AdminUserService, the real global
 * ValidationPipe, the real JwtAuthGuard/JwtStrategy and the real RolesGuard,
 * then drives them with actual fetch() calls.
 *
 * The ONLY substitution is the database: no MongoDB is reachable from this
 * machine, so the Mongoose models are replaced with in-memory stand-ins. What
 * the feature's correctness turns on — who may call which route, what the
 * filters return, and whether suspension actually revokes a session — is
 * exercised for real.
 *
 * The suspension-enforcement half is checked directly against AuthService,
 * because that is where the previous gap lived: the status check existed only
 * on password login, while OTP is the path customers actually use.
 *
 * Run: npx ts-node scripts/verify-admin-users.ts
 */
import 'reflect-metadata';
import { INestApplication, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';

import { AdminUserController } from '../src/modules/user/admin-user.controller';
import { AdminUserService } from '../src/modules/user/admin-user.service';
import { UserService } from '../src/modules/user/user.service';
import { User, UserStatus } from '../src/modules/user/schemas/user.schema';
import { Booking } from '../src/modules/booking/schemas/booking.schema';
import { QuoteRequest } from '../src/modules/quote/schemas/quote-request.schema';
import { PlanSubmission } from '../src/modules/plan/schemas/plan-submission.schema';
import { AuthService } from '../src/modules/auth/auth.service';
import { JwtStrategy } from '../src/modules/auth/strategies/jwt.strategy';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';
import { Role } from '../src/common/enums/role.enum';

const SECRET = 'verification-only-secret-not-a-real-one-0123456789';

// ---------------------------------------------------------------------------
// In-memory stand-ins
// ---------------------------------------------------------------------------

const users = new Map<string, any>();

function seedUser(data: any) {
  const id = new Types.ObjectId();
  const doc: any = {
    name: '',
    email: '',
    phone: '',
    city: '',
    roles: [Role.CUSTOMER],
    status: UserStatus.ACTIVE,
    phoneVerified: true,
    refreshTokenHash: 'a-live-session-hash',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...data,
    _id: id,
    save: async () => {
      doc.updatedAt = new Date();
      users.set(id.toString(), doc);
      return doc;
    },
  };
  users.set(id.toString(), doc);
  return doc;
}

function matches(row: any, filter: any): boolean {
  for (const [k, v] of Object.entries(filter ?? {})) {
    if (k === '$or') {
      if (!(v as any[]).some((c) => matches(row, c))) return false;
      continue;
    }
    if (v instanceof RegExp) {
      if (!v.test(String(row[k] ?? ''))) return false;
      continue;
    }
    if (Array.isArray(row[k])) {
      if (!row[k].includes(v)) return false;
      continue;
    }
    if (row[k] !== v) return false;
  }
  return true;
}

const userModel: any = {
  find: (filter: any) => {
    const chain: any = {
      _rows: [...users.values()].filter((r) => matches(r, filter)),
      sort() { return chain; },
      skip(n: number) { chain._rows = chain._rows.slice(n); return chain; },
      limit(n: number) { chain._rows = chain._rows.slice(0, n); return chain; },
      exec: async () => chain._rows,
    };
    return chain;
  },
  findById: (id: string) => ({ exec: async () => users.get(String(id)) ?? null }),
  countDocuments: (filter?: any) => ({
    exec: async () => [...users.values()].filter((r) => matches(r, filter)).length,
  }),
  findByIdAndUpdate: (id: string, patch: any) => ({
    exec: async () => {
      const doc = users.get(String(id));
      if (doc) Object.assign(doc, patch);
      return doc ?? null;
    },
  }),
  aggregate: (pipeline: any[]) => ({
    exec: async () => {
      const unwinds = pipeline.some((s) => s.$unwind === '$roles');
      const by = new Map<string, number>();
      for (const u of users.values()) {
        if (unwinds) for (const r of u.roles) by.set(r, (by.get(r) ?? 0) + 1);
        else by.set(u.status, (by.get(u.status) ?? 0) + 1);
      }
      return [...by.entries()].map(([_id, n]) => ({ _id, n }));
    },
  }),
};

const countingModel = (n: number): any => ({
  countDocuments: () => ({ exec: async () => n }),
});

// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failed += 1; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
}

async function main() {
  process.env.JWT_ACCESS_SECRET = SECRET;

  const admin = seedUser({ name: 'Asha Admin', email: 'asha@evently.com', phone: '9000000001', roles: [Role.ADMIN] });
  const customer = seedUser({ name: 'Ravi Kumar', email: 'ravi@example.com', phone: '9000000002', city: 'Hyderabad' });
  const organizer = seedUser({ name: 'Mahendra Events', email: 'me@example.com', phone: '9000000003', roles: [Role.CUSTOMER, Role.ORGANIZER] });
  seedUser({ name: 'Old Vendor', email: 'v@example.com', phone: '9000000004', roles: [Role.VENDOR], status: UserStatus.SUSPENDED });

  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [() => ({ jwt: { accessSecret: SECRET } })] }),
      PassportModule,
      JwtModule.register({ secret: SECRET }),
    ],
    controllers: [AdminUserController],
    providers: [
      AdminUserService,
      UserService,
      JwtStrategy,
      { provide: APP_GUARD, useClass: JwtAuthGuard },
      { provide: getModelToken(User.name), useValue: userModel },
      { provide: getModelToken(Booking.name), useValue: countingModel(3) },
      { provide: getModelToken(QuoteRequest.name), useValue: countingModel(5) },
      { provide: getModelToken(PlanSubmission.name), useValue: countingModel(2) },
    ],
  }).compile();

  const app: INestApplication = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(0);
  const base = `${await app.getUrl()}/api`.replace('[::1]', '127.0.0.1');

  const jwt = app.get(JwtService);
  const adminToken = jwt.sign({ sub: admin._id.toString(), roles: ['admin'] }, { secret: SECRET });
  const customerToken = jwt.sign({ sub: customer._id.toString(), roles: ['customer'] }, { secret: SECRET });

  const call = async (path: string, init: any = {}) => {
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
      },
      ...(init.body ? { body: JSON.stringify(init.body) } : {}),
    });
    let json: any = null;
    const text = await res.text();
    if (text) { try { json = JSON.parse(text); } catch { /* non-JSON */ } }
    return { status: res.status, json };
  };

  console.log('\nAUTHORIZATION');

  check('anonymous cannot list accounts', (await call('/admin/user/getUsers')).status === 401);
  check(
    'a customer cannot list accounts',
    (await call('/admin/user/getUsers', { token: customerToken })).status === 403,
  );
  check(
    'a customer cannot suspend anyone',
    (await call(`/admin/user/updateStatus/${organizer._id}`, {
      method: 'PATCH', token: customerToken, body: { status: 'suspended' },
    })).status === 403,
  );

  console.log('\nLIST, FILTER, SEARCH');

  const all = await call('/admin/user/getUsers', { token: adminToken });
  check('admin can list accounts', all.status === 200, `status ${all.status}`);
  check('every account is listed', all.json?.meta?.total === 4, String(all.json?.meta?.total));

  const row = all.json.data.find((r: any) => r.id === organizer._id.toString());
  check('row carries name, email and mobile', row?.name === 'Mahendra Events' && !!row?.email && !!row?.phone);
  check('a multi-role account lists every role', row?.roles?.length === 2 && row.roleLabels.includes('Organizer'));
  check('no credential material is exposed', !('passwordHash' in row) && !('refreshTokenHash' in row));

  const organizers = await call('/admin/user/getUsers?role=organizer', { token: adminToken });
  check('role filter narrows the list', organizers.json?.meta?.total === 1, String(organizers.json?.meta?.total));

  const suspendedOnly = await call('/admin/user/getUsers?status=suspended', { token: adminToken });
  check('status filter narrows the list', suspendedOnly.json?.meta?.total === 1);

  const searched = await call('/admin/user/getUsers?search=ravi', { token: adminToken });
  check('search matches name or email', searched.json?.data?.[0]?.id === customer._id.toString());

  const badRole = await call('/admin/user/getUsers?role=superuser', { token: adminToken });
  check('an invented role is rejected', badRole.status === 400, `status ${badRole.status}`);

  const counts = await call('/admin/user/getStatusCounts', { token: adminToken });
  check('counts are real', counts.json?.all === 4 && counts.json?.customer === 2 && counts.json?.suspended === 1,
    JSON.stringify(counts.json));

  console.log('\nDETAIL');

  const detail = await call(`/admin/user/getUserById/${customer._id}`, { token: adminToken });
  check('admin can open one account', detail.status === 200);
  check('detail shows the city', detail.json?.city === 'Hyderabad');
  check('detail carries real activity counts',
    detail.json?.activity?.bookings === 3 && detail.json?.activity?.quoteRequests === 5 && detail.json?.activity?.plans === 2,
    JSON.stringify(detail.json?.activity));
  check('an unknown id is a 404, not a crash',
    (await call(`/admin/user/getUserById/${new Types.ObjectId()}`, { token: adminToken })).status === 404);

  console.log('\nSUSPEND / REACTIVATE');

  const selfSuspend = await call(`/admin/user/updateStatus/${admin._id}`, {
    method: 'PATCH', token: adminToken, body: { status: 'suspended' },
  });
  check('an admin cannot suspend themselves', selfSuspend.status === 403, `status ${selfSuspend.status}`);
  check('the admin account is untouched', users.get(admin._id.toString()).status === UserStatus.ACTIVE);

  const badStatus = await call(`/admin/user/updateStatus/${customer._id}`, {
    method: 'PATCH', token: adminToken, body: { status: 'banished' },
  });
  check('an invented status is rejected', badStatus.status === 400);

  const suspend = await call(`/admin/user/updateStatus/${customer._id}`, {
    method: 'PATCH', token: adminToken, body: { status: 'suspended' },
  });
  check('admin can suspend an account', suspend.json?.status === 'suspended', String(suspend.json?.status));
  check('the change is persisted', users.get(customer._id.toString()).status === UserStatus.SUSPENDED);
  check('suspending revokes the live session',
    users.get(customer._id.toString()).refreshTokenHash === null,
    String(users.get(customer._id.toString()).refreshTokenHash));
  check('the response still carries activity', suspend.json?.activity?.bookings === 3);

  const reactivate = await call(`/admin/user/updateStatus/${customer._id}`, {
    method: 'PATCH', token: adminToken, body: { status: 'active' },
  });
  check('admin can reactivate', reactivate.json?.status === 'active');

  await app.close();

  console.log('\nSUSPENSION IS ENFORCED AT EVERY ENTRY POINT');

  // AuthService directly: this is where the gap was.
  const suspendedUser: any = {
    _id: new Types.ObjectId(),
    status: UserStatus.SUSPENDED,
    passwordHash: null,
    refreshTokenHash: 'still-here',
    roles: [Role.CUSTOMER],
    toJSON: () => ({}),
  };
  const auth = new AuthService(
    {
      findOrCreateByPhone: async () => ({ user: suspendedUser, isNew: false }),
      findByIdWithRefreshHash: async () => suspendedUser,
      findById: async () => suspendedUser,
      setRefreshTokenHash: async () => undefined,
    } as any,
    { signAsync: async () => 'token' } as any,
    { get: () => '1h' } as any,
    { verify: async () => '9000000002' } as any,
  );

  const rejects = async (fn: () => Promise<unknown>) => {
    try { await fn(); return false; } catch (e) { return e instanceof UnauthorizedException; }
  };

  check('OTP login rejects a suspended account',
    await rejects(() => auth.verifyOtp({ requestId: 'r', code: '000000' } as any)));
  check('refresh rejects a suspended account',
    await rejects(() => auth.refresh(suspendedUser._id.toString(), 'presented')));
  check('mid-session role upgrade rejects a suspended account',
    await rejects(() => auth.issueSessionForUser(suspendedUser._id.toString())));

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
