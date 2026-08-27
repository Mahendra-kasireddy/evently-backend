/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Admin console — verification over real HTTP for the vendor, event, booking,
 * payment and dashboard endpoints.
 *
 * Boots the real controllers, the real global ValidationPipe, the real
 * JwtAuthGuard/JwtStrategy and the real RolesGuard, then drives them with
 * actual fetch() calls. The only substitution is the database: no MongoDB is
 * reachable from this machine, so the Mongoose models are in-memory
 * stand-ins supporting the operations these services use.
 *
 * Run: npx ts-node scripts/verify-admin-console.ts
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

import { AdminSubvendorController } from '../src/modules/subvendor/admin-subvendor.controller';
import { AdminSubvendorService } from '../src/modules/subvendor/admin-subvendor.service';
import { AdminEventController } from '../src/modules/quote/admin-event.controller';
import { AdminEventService } from '../src/modules/quote/admin-event.service';
import {
  AdminBookingController,
  AdminPaymentController,
} from '../src/modules/booking/admin-booking.controller';
import { AdminBookingService } from '../src/modules/booking/admin-booking.service';
import { AdminDashboardController } from '../src/modules/admin/admin-dashboard.controller';
import { AdminDashboardService } from '../src/modules/admin/admin-dashboard.service';

import { User } from '../src/modules/user/schemas/user.schema';
import { OrganizerProfile } from '../src/modules/organizer/schemas/organizer-profile.schema';
import { SubVendorProfile } from '../src/modules/subvendor/schemas/subvendor-profile.schema';
import { SubVendorLink } from '../src/modules/subvendor/schemas/subvendor-link.schema';
import { QuoteRequest } from '../src/modules/quote/schemas/quote-request.schema';
import { Quotation } from '../src/modules/quote/schemas/quotation.schema';
import { Booking } from '../src/modules/booking/schemas/booking.schema';
import { ContactRequest } from '../src/modules/contact/schemas/contact-request.schema';
import { JwtStrategy } from '../src/modules/auth/strategies/jwt.strategy';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';

const SECRET = 'verification-only-secret-not-a-real-one-0123456789';

// ---------------------------------------------------------------------------
// A tiny in-memory Mongoose stand-in
// ---------------------------------------------------------------------------

function matches(row: any, filter: any): boolean {
  for (const [k, v] of Object.entries(filter ?? {})) {
    if (k === '$or') {
      if (!(v as any[]).some((c) => matches(row, c))) return false;
      continue;
    }
    /*
     * Dotted paths, including into arrays — `tasks.subVendorId` must match a
     * booking any of whose tasks names that vendor, the way Mongo does it.
     * Without this the vendor work-stats query silently matched nothing and
     * the assertion below was testing the harness, not the service.
     */
    const value = k.includes('.')
      ? k.split('.').reduce<any>((acc, part) => {
          if (Array.isArray(acc)) return acc.map((entry) => entry?.[part]).flat();
          return acc?.[part];
        }, row)
      : row[k];
    if (v instanceof RegExp) {
      if (!v.test(String(value ?? ''))) return false;
      continue;
    }
    if (v && typeof v === 'object' && '$in' in (v as any)) {
      const set = ((v as any).$in as any[]).map(String);
      if (Array.isArray(value)) {
        if (!value.some((x) => set.includes(String(x)))) return false;
      } else if (!set.includes(String(value))) return false;
      continue;
    }
    if (v && typeof v === 'object' && '$nin' in (v as any)) {
      const set = ((v as any).$nin as any[]).map(String);
      if (set.includes(String(value))) return false;
      continue;
    }
    if (Array.isArray(value)) {
      if (!value.map(String).includes(String(v))) return false;
      continue;
    }
    if (String(value) !== String(v)) return false;
  }
  return true;
}

function collection(seed: any[] = []) {
  const store = new Map<string, any>();
  for (const item of seed) store.set(item._id.toString(), item);

  const model: any = {
    _store: store,
    find: (filter: any) => {
      const chain: any = {
        _rows: [...store.values()].filter((r) => matches(r, filter)),
        sort() { return chain; },
        select() { return chain; },
        populate() { return chain; },
        skip(n: number) { chain._rows = chain._rows.slice(n); return chain; },
        limit(n: number) { chain._rows = chain._rows.slice(0, n); return chain; },
        exec: async () => chain._rows,
      };
      return chain;
    },
    findOne: (filter: any) => ({
      exec: async () => [...store.values()].find((r) => matches(r, filter)) ?? null,
    }),
    findById: (id: string) => {
      const chain: any = {
        populate() { return chain; },
        exec: async () => store.get(String(id)) ?? null,
      };
      return chain;
    },
    countDocuments: (filter?: any) => ({
      exec: async () => [...store.values()].filter((r) => matches(r, filter)).length,
    }),
    aggregate: (pipeline: any[]) => ({
      exec: async () => {
        let rows = [...store.values()];
        const match = pipeline.find((s) => s.$match)?.$match;
        if (match) rows = rows.filter((r) => matches(r, match));
        const unwind = pipeline.find((s) => s.$unwind)?.$unwind;
        const group = pipeline.find((s) => s.$group)?.$group;
        if (!group) return rows;

        if (group._id === null) {
          const out: any = { _id: null };
          for (const [field, spec] of Object.entries<any>(group)) {
            if (field === '_id') continue;
            if (spec.$sum === 1) out[field] = rows.length;
            else {
              const path = spec.$sum?.$ifNull?.[0] ?? spec.$sum;
              const key = String(path).replace('$', '');
              out[field] = rows.reduce((n, r) => n + (r[key] ?? 0), 0);
            }
          }
          return [out];
        }

        const key = String(group._id).replace('$', '');
        const by = new Map<string, number>();
        for (const r of rows) {
          const values = unwind ? (r[key] ?? []) : [r[key]];
          for (const v of values) by.set(String(v), (by.get(String(v)) ?? 0) + 1);
        }
        return [...by.entries()].map(([_id, n]) => ({ _id, n }));
      },
    }),
  };
  return model;
}

const oid = () => new Types.ObjectId();
const doc = (data: any) => {
  const d: any = { _id: oid(), createdAt: new Date(), updatedAt: new Date(), ...data };
  d.save = async () => d;
  return d;
};

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failed += 1; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
}

async function main() {
  process.env.JWT_ACCESS_SECRET = SECRET;

  const adminId = oid();
  const customerId = oid();
  const vendorUserId = oid();

  const users = collection([
    doc({ _id: adminId, name: 'Asha Admin', roles: ['admin'], status: 'active' }),
    doc({ _id: customerId, name: 'Ravi Kumar', email: 'ravi@example.com', phone: '9000000002', roles: ['customer'], status: 'active' }),
    doc({ _id: vendorUserId, name: 'Suresh Catering', email: 's@example.com', phone: '9000000005', roles: ['vendor'], status: 'suspended' }),
  ]);

  const vendorId = oid();
  const vendors = collection([
    doc({ _id: vendorId, user: vendorUserId, fullName: 'Suresh Catering', initials: 'SC', avatarColor: '#1d9e75', category: 'food', serviceArea: 'Kukatpally', baseRate: 450, baseRateUnit: 'plate', minOrder: 100, active: true }),
    doc({ user: oid(), fullName: 'Bloom Decor', initials: 'BD', avatarColor: '#7c5bd6', category: 'decor', serviceArea: 'Madhapur', baseRate: 0, baseRateUnit: '', minOrder: 0, active: false }),
  ]);

  const links = collection([
    doc({ organizer: oid(), subVendor: vendorId, status: 'active', ratingTotal: 9, ratingCount: 2 }),
  ]);

  const requestId = oid();
  const requests = collection([
    doc({ _id: requestId, customer: customerId, organizer: null, occasion: 'Naming', when: '2026-09-05', where: 'Kukatpally', guests: '150', budget: '1-2L', categories: ['food'], ideas: 'Simple and warm', status: 'quoted' }),
    doc({ customer: customerId, organizer: null, occasion: 'Wedding', when: '2027-01-10', where: 'Jubilee Hills', guests: '500', budget: '10L+', categories: [], ideas: '', status: 'open' }),
  ]);

  const quotations = collection([
    doc({ request: requestId, organizer: oid(), status: 'sent', grandTotal: 74617, advancePercentage: 30 }),
  ]);

  const bookingId = oid();
  const bookings = collection([
    doc({ _id: bookingId, customer: customerId, organizer: oid(), request: requestId, ref: 'EVT-2026-1977', title: 'Naming · 2026-09-05', occasion: 'Naming', location: 'Kukatpally', eventDate: new Date('2026-09-05'), amount: 74617, advancePercentage: 30, advanceAmount: 22385, amountPaid: 22385, paymentStatus: 'advance_paid', status: 'awaiting_organizer', progress: 20, steps: [], timeline: [], tasks: [{ title: 'Catering', status: 'todo', assigneeName: 'Suresh Catering', subVendorId: vendorId, assignmentStatus: 'accepted', amount: 45000 }], declineReason: '' }),
    doc({ customer: customerId, organizer: oid(), ref: 'EVT-2026-0001', title: 'Birthday', occasion: 'Birthday', location: 'Gachibowli', eventDate: new Date('2026-05-01'), amount: 50000, advancePercentage: 30, advanceAmount: 15000, amountPaid: 15000, paymentStatus: 'advance_paid', status: 'cancelled', progress: 0, steps: [], timeline: [], tasks: [] }),
  ]);

  const organizers = collection([
    doc({ status: 'pending_review' }),
    doc({ status: 'submitted' }),
    doc({ status: 'approved' }),
  ]);

  const contacts = collection([
    doc({ status: 'new' }),
    doc({ status: 'responded' }),
  ]);

  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [() => ({ jwt: { accessSecret: SECRET } })] }),
      PassportModule,
      JwtModule.register({ secret: SECRET }),
    ],
    controllers: [
      AdminSubvendorController,
      AdminEventController,
      AdminBookingController,
      AdminPaymentController,
      AdminDashboardController,
    ],
    providers: [
      AdminSubvendorService, AdminEventService, AdminBookingService, AdminDashboardService,
      JwtStrategy,
      { provide: APP_GUARD, useClass: JwtAuthGuard },
      { provide: getModelToken(User.name), useValue: users },
      { provide: getModelToken(OrganizerProfile.name), useValue: organizers },
      { provide: getModelToken(SubVendorProfile.name), useValue: vendors },
      { provide: getModelToken(SubVendorLink.name), useValue: links },
      { provide: getModelToken(QuoteRequest.name), useValue: requests },
      { provide: getModelToken(Quotation.name), useValue: quotations },
      { provide: getModelToken(Booking.name), useValue: bookings },
      { provide: getModelToken(ContactRequest.name), useValue: contacts },
    ],
  }).compile();

  const app: INestApplication = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(0);
  const base = `${await app.getUrl()}/api`.replace('[::1]', '127.0.0.1');

  const jwt = app.get(JwtService);
  const adminToken = jwt.sign({ sub: adminId.toString(), roles: ['admin'] }, { secret: SECRET });
  const customerToken = jwt.sign({ sub: customerId.toString(), roles: ['customer'] }, { secret: SECRET });

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

  console.log('\nAUTHORIZATION — every new route');

  const guarded = [
    '/admin/subvendor/getSubVendors',
    '/admin/event/getEvents',
    '/admin/booking/getBookings',
    '/admin/payment/getPayments',
    '/admin/payment/getTotals',
    '/admin/dashboard/getSummary',
  ];
  for (const path of guarded) {
    const anon = await call(path);
    const cust = await call(path, { token: customerToken });
    check(`${path} — anonymous gets 401`, anon.status === 401, `got ${anon.status}`);
    check(`${path} — customer gets 403`, cust.status === 403, `got ${cust.status}`);
  }
  const vendorWrite = await call(`/admin/subvendor/updateActive/${vendorId}`, {
    method: 'PATCH', token: customerToken, body: { active: false },
  });
  check('a customer cannot change the roster', vendorWrite.status === 403, `got ${vendorWrite.status}`);

  console.log('\nVENDORS');

  const vList = await call('/admin/subvendor/getSubVendors', { token: adminToken });
  check('admin can list vendors', vList.status === 200 && vList.json.meta.total === 2);
  const vRow = vList.json.data.find((r: any) => r.id === vendorId.toString());
  check('row carries the category label', vRow?.categoryLabel === 'Food & catering', String(vRow?.categoryLabel));
  check('row carries a live organizer count', vRow?.organizerCount === 1, String(vRow?.organizerCount));

  const vFiltered = await call('/admin/subvendor/getSubVendors?category=decor', { token: adminToken });
  check('category filter narrows the roster', vFiltered.json.meta.total === 1);
  const vInactive = await call('/admin/subvendor/getSubVendors?active=false', { token: adminToken });
  check('active filter narrows the roster', vInactive.json.meta.total === 1);
  const vBad = await call('/admin/subvendor/getSubVendors?category=fireworks', { token: adminToken });
  check('an invented category is rejected', vBad.status === 400, `got ${vBad.status}`);

  const vCounts = await call('/admin/subvendor/getStatusCounts', { token: adminToken });
  check('vendor counts are real', vCounts.json.all === 2 && vCounts.json.active === 1 && vCounts.json.food === 1,
    JSON.stringify(vCounts.json));

  const vDetail = await call(`/admin/subvendor/getSubVendorById/${vendorId}`, { token: adminToken });
  check('vendor detail resolves the account behind it', vDetail.json?.account?.name === 'Suresh Catering');
  check('vendor detail flags a suspended account', vDetail.json?.account?.suspended === true);
  check('vendor detail lists linked organizers', vDetail.json?.organizers?.length === 1);
  check('vendor detail averages real ratings', vDetail.json?.organizers?.[0]?.rating === 4.5,
    String(vDetail.json?.organizers?.[0]?.rating));
  check('vendor detail counts assigned work',
    vDetail.json?.work?.assigned === 1 && vDetail.json?.work?.accepted === 1 && vDetail.json?.work?.agreedValue === 45000,
    JSON.stringify(vDetail.json?.work));

  const toggled = await call(`/admin/subvendor/updateActive/${vendorId}`, {
    method: 'PATCH', token: adminToken, body: { active: false },
  });
  check('admin can take a vendor off the roster', toggled.json?.active === false);
  check('the change is persisted', vendors._store.get(vendorId.toString()).active === false);

  console.log('\nEVENTS');

  const eList = await call('/admin/event/getEvents', { token: adminToken });
  check('admin can list the pipeline', eList.status === 200 && eList.json.meta.total === 2);
  const eRow = eList.json.data.find((r: any) => r.id === requestId.toString());
  check('row carries a live quote count', eRow?.quoteCount === 1, String(eRow?.quoteCount));
  check('row carries a readable status', eRow?.statusLabel === 'Quotes received', String(eRow?.statusLabel));

  const eFiltered = await call('/admin/event/getEvents?status=open', { token: adminToken });
  check('status filter narrows the pipeline', eFiltered.json.meta.total === 1);
  const eBad = await call('/admin/event/getEvents?status=maybe', { token: adminToken });
  check('an invented status is rejected', eBad.status === 400);

  const eDetail = await call(`/admin/event/getEventById/${requestId}`, { token: adminToken });
  check('event detail lists organizer quotes', eDetail.json?.quotes?.length === 1);
  check('event detail links across to the booking', eDetail.json?.booking?.ref === 'EVT-2026-1977',
    JSON.stringify(eDetail.json?.booking));
  check('an unknown event id is a 404',
    (await call(`/admin/event/getEventById/${oid()}`, { token: adminToken })).status === 404);

  console.log('\nBOOKINGS');

  const bList = await call('/admin/booking/getBookings', { token: adminToken });
  check('admin can list bookings', bList.status === 200 && bList.json.meta.total === 2);
  const bRow = bList.json.data.find((r: any) => r.ref === 'EVT-2026-1977');
  check('booking and payment status are separate fields',
    bRow?.status === 'awaiting_organizer' && bRow?.paymentStatus === 'advance_paid');
  check('outstanding is derived correctly', bRow?.outstanding === 74617 - 22385, String(bRow?.outstanding));

  const bFiltered = await call('/admin/booking/getBookings?status=cancelled', { token: adminToken });
  check('status filter narrows bookings', bFiltered.json.meta.total === 1);
  const bSearch = await call('/admin/booking/getBookings?search=EVT-2026-1977', { token: adminToken });
  check('search matches the reference', bSearch.json.meta.total === 1);

  const bDetail = await call(`/admin/booking/getBookingById/${bookingId}`, { token: adminToken });
  check('booking detail carries the task board', bDetail.json?.tasks?.length === 1);
  check('booking detail carries the timeline array', Array.isArray(bDetail.json?.timeline));

  console.log('\nPAYMENTS');

  const totals = await call('/admin/payment/getTotals', { token: adminToken });
  check('totals sum the whole slice, not a page',
    totals.json?.bookings === 2 && totals.json?.contractedValue === 124617 && totals.json?.collected === 37385,
    JSON.stringify(totals.json));
  check('outstanding is total minus collected', totals.json?.outstanding === 124617 - 37385);

  const filteredTotals = await call('/admin/payment/getTotals?paymentStatus=advance_paid', { token: adminToken });
  check('totals respect the filter', filteredTotals.json?.bookings === 2);

  console.log('\nDASHBOARD');

  const dash = await call('/admin/dashboard/getSummary', { token: adminToken });
  check('admin can read the summary', dash.status === 200);

  const section = (k: string) => dash.json.sections.find((s: any) => s.key === k);
  check('users count is real', section('users')?.total === 3, String(section('users')?.total));
  check('organizers count is real', section('organizers')?.total === 3);
  check('organizers attention counts both review gates', section('organizers')?.attention === 2,
    String(section('organizers')?.attention));
  check('vendors count is real', section('vendors')?.total === 2);
  check('events count is real', section('events')?.total === 2);
  check('bookings count is real', section('bookings')?.total === 2);
  check('messages attention counts only new', section('contact')?.attention === 1);

  const item = (k: string) => dash.json.attention.find((a: any) => a.key === k);
  check('the queue lists organizers pending review', item('organizers-pending')?.count === 1);
  check('the queue lists unread messages', item('contact-new')?.count === 1);
  check('the queue lists bookings awaiting an organizer', item('bookings-awaiting')?.count === 1);
  check('queue links are pre-filtered', item('contact-new')?.href === '/contact-us?status=new',
    String(item('contact-new')?.href));
  check('zero-count rows are omitted from the queue',
    dash.json.attention.every((a: any) => a.count > 0));

  check('dashboard finance excludes cancelled bookings',
    dash.json.finance.contractedValue === 74617 && dash.json.finance.collected === 22385,
    JSON.stringify(dash.json.finance));
  check('dashboard outstanding is derived', dash.json.finance.outstanding === 74617 - 22385);

  await app.close();
  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
