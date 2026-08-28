/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Account settings — what a signed-in user may change about themselves.
 *
 * The sub-vendor settings screen writes through `PATCH /user/updateProfile`,
 * so this drives the real UserController with the real global ValidationPipe
 * and the real JwtAuthGuard. The point of interest is what the DTO does NOT
 * declare: `roles` and `status` must be stripped, because the service passes
 * the validated body straight to findByIdAndUpdate.
 *
 * Run: npx ts-node scripts/verify-account-settings.ts
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

import { UserController } from '../src/modules/user/user.controller';
import { UserService } from '../src/modules/user/user.service';
import { User } from '../src/modules/user/schemas/user.schema';
import { JwtStrategy } from '../src/modules/auth/strategies/jwt.strategy';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';

const SECRET = 'verification-only-secret-not-a-real-one-0123456789';

const userId = new Types.ObjectId();
const record: any = {
  _id: userId,
  name: 'Anil Balloons',
  email: 'anil@example.com',
  phone: '9000000005',
  city: 'Hyderabad',
  roles: ['customer', 'vendor'],
  status: 'active',
};
record.toJSON = () => ({ ...record, id: record._id.toString() });

const users: any = {
  findById: (id: string) => ({
    exec: async () => (String(id) === userId.toString() ? record : null),
  }),
  findByIdAndUpdate: (id: string, patch: any) => ({
    exec: async () => {
      if (String(id) !== userId.toString()) return null;
      Object.assign(record, patch);
      return record;
    },
  }),
};

let passed = 0, failed = 0;
const check = (n: string, ok: boolean, d = '') => {
  if (ok) { passed++; console.log(`  PASS  ${n}`); }
  else { failed++; console.log(`  FAIL  ${n}${d ? ` — ${d}` : ''}`); }
};

async function main() {
  process.env.JWT_ACCESS_SECRET = SECRET;

  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [() => ({ jwt: { accessSecret: SECRET } })] }),
      PassportModule,
      JwtModule.register({ secret: SECRET }),
    ],
    controllers: [UserController],
    providers: [
      UserService, JwtStrategy,
      { provide: APP_GUARD, useClass: JwtAuthGuard },
      { provide: getModelToken(User.name), useValue: users },
    ],
  }).compile();

  const app: INestApplication = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(0);
  const base = `${await app.getUrl()}/api`.replace('[::1]', '127.0.0.1');

  const token = app.get(JwtService).sign(
    { sub: userId.toString(), roles: ['vendor'] }, { secret: SECRET },
  );

  const call = async (path: string, init: any = {}) => {
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init.anon ? {} : { Authorization: `Bearer ${token}` }),
      },
      ...(init.body ? { body: JSON.stringify(init.body) } : {}),
    });
    const t = await res.text();
    let json: any = null;
    if (t) { try { json = JSON.parse(t); } catch { /* non-JSON */ } }
    return { status: res.status, json };
  };
  const patch = (body: any) => call('/user/updateProfile', { method: 'PATCH', body });

  console.log('\nREADING THE ACCOUNT');

  check('anonymous cannot read the account',
    (await call('/user/getUserDetails', { anon: true })).status === 401);

  const me = await call('/user/getUserDetails');
  check('a signed-in user reads their own account', me.status === 200);
  check('name, email, phone and city are all present',
    me.json?.name === 'Anil Balloons' && me.json?.email === 'anil@example.com' &&
    me.json?.phone === '9000000005' && me.json?.city === 'Hyderabad');
  check('no credential material is returned',
    !('passwordHash' in (me.json ?? {})) && !('refreshTokenHash' in (me.json ?? {})));

  console.log('\nEDITING WHAT IS ALLOWED');

  const ok = await patch({ name: 'Anil Reddy', city: 'Gachibowli', email: 'anil2@example.com' });
  check('name, city and email save', ok.status === 200, `status ${ok.status}`);
  check('the new name is stored', record.name === 'Anil Reddy', record.name);
  check('the new city is stored', record.city === 'Gachibowli', record.city);
  check('the new email is stored', record.email === 'anil2@example.com', record.email);

  console.log('\nWHAT MUST BE STRIPPED');

  const beforeRoles = [...record.roles];
  const escalate = await patch({ name: 'Anil Reddy', roles: ['admin'] });
  check('the request still succeeds', escalate.status === 200, `status ${escalate.status}`);
  check('roles are stripped — a vendor cannot make themselves an admin',
    JSON.stringify(record.roles) === JSON.stringify(beforeRoles), JSON.stringify(record.roles));

  const suspended = { ...record, status: 'suspended' };
  record.status = 'suspended';
  const unsuspend = await patch({ name: 'Anil Reddy', status: 'active' });
  check('the request still succeeds', unsuspend.status === 200);
  check('status is stripped — a suspended account cannot revive itself',
    record.status === 'suspended', String(record.status));
  record.status = suspended.status === 'suspended' ? 'active' : record.status;

  console.log('\nVALIDATION');

  check('a one-character name is rejected', (await patch({ name: 'x' })).status === 400);
  check('an over-long name is rejected', (await patch({ name: 'x'.repeat(81) })).status === 400);
  check('a malformed email is rejected', (await patch({ email: 'nope' })).status === 400);
  check('an over-long city is rejected', (await patch({ city: 'x'.repeat(121) })).status === 400);
  check('an empty patch is accepted', (await patch({})).status === 200);

  await app.close();
  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}
void main();
