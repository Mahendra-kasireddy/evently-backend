/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Contact Us — end-to-end verification over real HTTP.
 *
 * Boots the real ContactController, AdminContactController, ContactService,
 * the real global ValidationPipe, the real JwtAuthGuard/JwtStrategy and the
 * real RolesGuard, then drives them with actual fetch() calls.
 *
 * The ONLY substitution is the database: no MongoDB is reachable from this
 * machine, so the Mongoose model is replaced with an in-memory stand-in that
 * implements the handful of operations ContactService uses. Everything the
 * feature's correctness actually turns on — routing, validation, who is
 * allowed through which guard, whose id gets attached to a submission, and the
 * state transitions on respond — is exercised for real.
 *
 * Run: npx ts-node scripts/verify-contact.ts
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

import { ContactController } from '../src/modules/contact/contact.controller';
import { AdminContactController } from '../src/modules/contact/admin-contact.controller';
import { ContactService } from '../src/modules/contact/contact.service';
import { SupportMailProvider } from '../src/modules/contact/providers/support-mail.provider';
import { ContactRequest } from '../src/modules/contact/schemas/contact-request.schema';
import { NotificationService } from '../src/modules/notification/notification.service';
import { UserService } from '../src/modules/user/user.service';
import { JwtStrategy } from '../src/modules/auth/strategies/jwt.strategy';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';

const SECRET = 'verification-only-secret-not-a-real-one-0123456789';

// ---------------------------------------------------------------------------
// In-memory stand-in for the Mongoose model
// ---------------------------------------------------------------------------

const store = new Map<string, any>();

function makeDoc(data: any) {
  const doc: any = {
    ...data,
    _id: new Types.ObjectId(),
    createdAt: new Date(),
    updatedAt: new Date(),
    save: async () => {
      doc.updatedAt = new Date();
      store.set(doc._id.toString(), doc);
      return doc;
    },
  };
  store.set(doc._id.toString(), doc);
  return doc;
}

const fakeModel: any = {
  create: async (data: any) => makeDoc(data),
  findById: (id: string) => ({ exec: async () => store.get(String(id)) ?? null }),
  find: (filter: any) => {
    const chain: any = {
      _rows: [...store.values()].filter((r) => matches(r, filter)),
      sort() { return chain; },
      skip(n: number) { chain._rows = chain._rows.slice(n); return chain; },
      limit(n: number) { chain._rows = chain._rows.slice(0, n); return chain; },
      exec: async () => chain._rows,
    };
    return chain;
  },
  countDocuments: (filter: any) => ({
    exec: async () => [...store.values()].filter((r) => matches(r, filter)).length,
  }),
  aggregate: () => ({
    exec: async () => {
      const by = new Map<string, number>();
      for (const r of store.values()) by.set(r.status, (by.get(r.status) ?? 0) + 1);
      return [...by.entries()].map(([_id, n]) => ({ _id, n }));
    },
  }),
};

function matches(row: any, filter: any): boolean {
  for (const [k, v] of Object.entries(filter ?? {})) {
    if (k === '$or') {
      if (!(v as any[]).some((clause) => matches(row, clause))) return false;
      continue;
    }
    if (v instanceof RegExp) {
      if (!v.test(String(row[k] ?? ''))) return false;
      continue;
    }
    if (row[k] !== v) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function main() {
  process.env.JWT_ACCESS_SECRET = SECRET;

  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        // No SMTP_HOST: the stub path, which is the real current state.
        load: [() => ({ jwt: { accessSecret: SECRET }, mail: { host: undefined } })],
      }),
      PassportModule,
      JwtModule.register({ secret: SECRET }),
    ],
    controllers: [ContactController, AdminContactController],
    providers: [
      ContactService,
      SupportMailProvider,
      JwtStrategy,
      { provide: APP_GUARD, useClass: JwtAuthGuard },
      { provide: getModelToken(ContactRequest.name), useValue: fakeModel },
      { provide: NotificationService, useValue: { create: async () => ({}) } },
      {
        provide: UserService,
        useValue: {
          findById: async () => ({
            name: 'Priya Nair',
            email: 'priya@example.com',
            phone: '9876500011',
          }),
        },
      },
    ],
  }).compile();

  const app: INestApplication = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: false, transform: true }),
  );
  await app.listen(0);
  const base = `${await app.getUrl()}/api`.replace('[::1]', '127.0.0.1');

  const jwt = app.get(JwtService);
  const customerId = new Types.ObjectId().toString();
  const adminId = new Types.ObjectId().toString();
  const customerToken = jwt.sign({ sub: customerId, roles: ['customer'] }, { secret: SECRET });
  const adminToken = jwt.sign({ sub: adminId, roles: ['admin'] }, { secret: SECRET });

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

  const guestPayload = {
    name: 'Ravi Kumar',
    email: 'ravi@example.com',
    phone: '9876543210',
    subject: 'booking',
    message: 'My booking EVT-2026-1977 still shows as pending. Can you check?',
  };

  console.log('\nCUSTOMER — public submission');

  const guest = await call('/contact-us', { method: 'POST', body: guestPayload });
  check('guest can submit without a token', guest.status === 201, `status ${guest.status}`);
  check('submission returns an id', !!guest.json?.id);
  check('new submission starts at NEW', guest.json?.status === 'new', String(guest.json?.status));

  const guestDoc = store.get(guest.json?.id);
  check('guest submission stored with no user', guestDoc?.user === null);

  const authed = await call('/contact-us', {
    method: 'POST',
    token: customerToken,
    body: { ...guestPayload, email: 'priya@example.com', subject: 'billing' },
  });
  check('signed-in customer can submit', authed.status === 201, `status ${authed.status}`);
  const authedDoc = store.get(authed.json?.id);
  check(
    'submission is attributed to the token holder',
    authedDoc?.user?.toString() === customerId,
    `got ${authedDoc?.user?.toString()}`,
  );

  const spoof = await call('/contact-us', {
    method: 'POST',
    body: { ...guestPayload, userId: adminId, user: adminId },
  });
  const spoofDoc = store.get(spoof.json?.id);
  check(
    'a userId in the body cannot claim an account',
    spoofDoc?.user === null,
    `got ${spoofDoc?.user}`,
  );

  const badToken = await call('/contact-us', {
    method: 'POST',
    token: 'not-a-real-token',
    body: guestPayload,
  });
  check(
    'an invalid token degrades to a guest submission rather than failing',
    badToken.status === 201,
    `status ${badToken.status}`,
  );

  console.log('\nCUSTOMER — validation');

  const empty = await call('/contact-us', { method: 'POST', body: {} });
  check('empty form is rejected', empty.status === 400, `status ${empty.status}`);
  const msgs = JSON.stringify(empty.json?.message ?? empty.json);
  check('name is required', /name/i.test(msgs));
  check('email is required', /email/i.test(msgs));
  check('phone is required', /mobile|phone/i.test(msgs));
  check('subject is required', /subject|message.*about/i.test(msgs));
  check('message is required', /message/i.test(msgs));

  const badEmail = await call('/contact-us', {
    method: 'POST',
    body: { ...guestPayload, email: 'not-an-email' },
  });
  check('malformed email is rejected', badEmail.status === 400);

  const badPhone = await call('/contact-us', {
    method: 'POST',
    body: { ...guestPayload, phone: '12345' },
  });
  check('short mobile number is rejected', badPhone.status === 400);

  const badSubject = await call('/contact-us', {
    method: 'POST',
    body: { ...guestPayload, subject: 'refunds-please' },
  });
  check('unknown subject is rejected', badSubject.status === 400);

  const prefillAnon = await call('/contact-us/prefill');
  check('prefill requires a session', prefillAnon.status === 401, `status ${prefillAnon.status}`);
  const prefill = await call('/contact-us/prefill', { token: customerToken });
  check(
    'prefill returns the account name, email and phone',
    prefill.status === 200 &&
      prefill.json?.name === 'Priya Nair' &&
      prefill.json?.email === 'priya@example.com' &&
      prefill.json?.phone === '9876500011',
  );

  console.log('\nADMIN — authorization');

  const listAnon = await call('/admin/contact-us/getContactRequests');
  check('guest cannot read the admin queue', listAnon.status === 401, `status ${listAnon.status}`);

  const listCustomer = await call('/admin/contact-us/getContactRequests', { token: customerToken });
  check(
    'a signed-in customer cannot read the admin queue',
    listCustomer.status === 403,
    `status ${listCustomer.status}`,
  );

  const respondAsCustomer = await call(`/admin/contact-us/respond/${guest.json.id}`, {
    method: 'POST',
    token: customerToken,
    body: { response: 'I am not an admin but here is a reply.' },
  });
  check(
    'a customer cannot respond to a request',
    respondAsCustomer.status === 403,
    `status ${respondAsCustomer.status}`,
  );

  console.log('\nADMIN — queue');

  const list = await call('/admin/contact-us/getContactRequests', { token: adminToken });
  check('admin can list requests', list.status === 200, `status ${list.status}`);
  check('the queue contains the submissions', (list.json?.data?.length ?? 0) >= 2);
  const row = list.json?.data?.find((r: any) => r.id === guest.json.id);
  check('row carries the customer name and email', row?.name === 'Ravi Kumar' && !!row?.email);
  check('row flags a guest submission', row?.isGuest === true);
  check('row carries a readable subject', row?.subjectLabel === 'Booking', String(row?.subjectLabel));
  check('row carries created and updated dates', !!row?.createdAt && !!row?.updatedAt);

  const counts = await call('/admin/contact-us/getStatusCounts', { token: adminToken });
  check('status counts are real', counts.json?.all === store.size, JSON.stringify(counts.json));

  const search = await call('/admin/contact-us/getContactRequests?search=ravi', {
    token: adminToken,
  });
  check('search matches on name/email', (search.json?.data?.length ?? 0) >= 1);

  const filtered = await call('/admin/contact-us/getContactRequests?status=closed', {
    token: adminToken,
  });
  check('status filter narrows the queue', filtered.json?.data?.length === 0);

  console.log('\nADMIN — detail, status and response');

  const detail = await call(`/admin/contact-us/getContactRequestById/${guest.json.id}`, {
    token: adminToken,
  });
  check('admin can open one request', detail.status === 200);
  check('detail shows the full message', detail.json?.message === guestPayload.message);
  check('detail shows the phone number', detail.json?.phone === '9876543210');
  check('detail has no reply yet', detail.json?.response === '');

  const missing = await call(
    `/admin/contact-us/getContactRequestById/${new Types.ObjectId().toString()}`,
    { token: adminToken },
  );
  check('an unknown id is a 404, not a crash', missing.status === 404, `status ${missing.status}`);

  const progressed = await call(`/admin/contact-us/updateStatus/${guest.json.id}`, {
    method: 'PATCH',
    token: adminToken,
    body: { status: 'in_progress' },
  });
  check('admin can change status', progressed.json?.status === 'in_progress');

  const badStatus = await call(`/admin/contact-us/updateStatus/${guest.json.id}`, {
    method: 'PATCH',
    token: adminToken,
    body: { status: 'escalated' },
  });
  check('an invented status is rejected', badStatus.status === 400);

  const emptyReply = await call(`/admin/contact-us/respond/${guest.json.id}`, {
    method: 'POST',
    token: adminToken,
    body: { response: '' },
  });
  check('an empty response is rejected', emptyReply.status === 400);

  const replyText = 'Hi Ravi — the organizer has now confirmed EVT-2026-1977. You are all set.';
  const responded = await call(`/admin/contact-us/respond/${guest.json.id}`, {
    method: 'POST',
    token: adminToken,
    body: { response: replyText },
  });
  check('admin can respond', responded.status === 201, `status ${responded.status}`);
  check('the response is returned in the detail', responded.json?.response === replyText);
  check('responding moves the request to RESPONDED', responded.json?.status === 'responded');
  check('the response timestamp is stamped', !!responded.json?.respondedAt);

  const saved = store.get(guest.json.id);
  check('the response is persisted, not frontend state', saved?.response === replyText);
  check('the responding admin is recorded', saved?.respondedBy?.toString() === adminId);
  check(
    'email delivery is reported honestly as not sent (no SMTP configured)',
    saved?.responseEmailed === false && responded.json?.responseEmailed === false,
  );

  const reread = await call(`/admin/contact-us/getContactRequestById/${guest.json.id}`, {
    token: adminToken,
  });
  check('the reply survives a re-read', reread.json?.response === replyText);
  check('the status survives a re-read', reread.json?.status === 'responded');

  await app.close();

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
