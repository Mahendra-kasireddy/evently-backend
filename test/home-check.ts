/**
 * Which event does Home show, and why not the others?
 *
 * Home draws exactly one "current event". This lists every plan, brief and
 * booking an account has, marks the ones eligible, and names the winner and
 * the rule that picked it — because with two events on the go, the usual
 * surprise is not that a record is missing but that a further-along one is
 * covering it.
 *
 *   npm run check:home                    # the most recently created customer
 *   npm run check:home 9876543210         # by phone
 *   npm run check:home someone@email.com  # by email
 *
 * Read-only. It opens the database this API is configured against and writes
 * nothing.
 */
import 'dotenv/config';
import mongoose from 'mongoose';

/*
 * The real collection names, taken from the schemas' own `collection:` option.
 *
 * Mongoose's default pluralisation would give "quoterequests" and
 * "plansubmissions", which exist in no database — and querying a collection
 * that is not there returns nothing at all rather than an error, so getting
 * these wrong makes the script report "never sent a brief" about a customer
 * with a dozen. `assertCollections` refuses to run rather than let that happen.
 */
const COLLECTIONS = {
  users: 'users',
  requests: 'quote_requests',
  quotations: 'quotations',
  bookings: 'bookings',
  plans: 'plan_submissions',
} as const;

/** The request statuses `getLatestActiveForUser` will consider. */
const LIVE_REQUEST = ['open', 'quoted', 'accepted'];
/** BookingService.LIVE_BOOKING_STATUSES — a booking Home treats as live. */
const LIVE_BOOKING = ['pending', 'awaiting_organizer', 'confirmed', 'in_progress'];
/** PlanStatus values that are still the customer's live plan. */
const LIVE_PLAN = ['draft', 'submitted'];

/**
 * CurrentEventService.STAGE_RANK — the furthest-along candidate wins, and on a
 * tie the order booking > quote > plan decides it.
 */
const RANK: Record<string, number> = {
  draft: 1,
  submitted: 2,
  quotes_received: 3,
  quote_accepted: 4,
  booking_created: 5,
  booking_confirmed: 6,
  in_progress: 7,
  completed: 8,
};

interface Row {
  _id: unknown;
  [key: string]: unknown;
}

interface Candidate {
  kind: 'booking' | 'brief' | 'plan';
  label: string;
  stage: string;
  rank: number;
  /** The record's own id, and the ids it is joined to, for the dedup below. */
  id: string;
  planId: string | null;
  requestId: string | null;
}

const HOW_MANY = 10;

function date(value: unknown): string {
  if (!value) return '—';
  const d = new Date(value as string);
  return Number.isNaN(d.getTime()) ? '—' : d.toISOString().slice(0, 10);
}

/**
 * Stops before reporting anything, if a collection is missing.
 *
 * An empty answer from the wrong collection looks exactly like an empty answer
 * from the right one, and is far more misleading than a crash.
 */
async function assertCollections(db: mongoose.mongo.Db): Promise<void> {
  const present = new Set((await db.listCollections().toArray()).map((c) => c.name));
  const missing = Object.values(COLLECTIONS).filter((name) => !present.has(name));
  if (missing.length === 0) return;

  console.error(`These collections are not in ${db.databaseName}: ${missing.join(', ')}`);
  console.error('Either this database is not the one the API uses, or a schema was renamed.');
  console.error(`It holds: ${[...present].sort().join(', ')}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const uri = process.env.MONGO_URI ?? process.env.MONGODB_URI ?? '';
  if (!uri) {
    console.error('No MONGO_URI in .env — run this from the backend folder.');
    process.exit(1);
  }

  await mongoose.connect(uri, { dbName: process.env.MONGO_DB_NAME });
  const db = mongoose.connection.db;
  if (!db) throw new Error('No database handle');
  await assertCollections(db);
  console.log(`database: ${db.databaseName}\n`);

  const needle = (process.argv[2] ?? '').trim();
  const user = needle
    ? await db
        .collection<Row>(COLLECTIONS.users)
        .findOne({ $or: [{ phone: needle }, { mobile: needle }, { email: needle }] })
    : await db.collection<Row>(COLLECTIONS.users).findOne({}, { sort: { createdAt: -1 } });

  if (!user) {
    console.log(
      needle
        ? `No user matched "${needle}". Try a phone or email exactly as it is stored.`
        : 'There are no users in this database at all — the API may be pointed elsewhere.',
    );
    await mongoose.disconnect();
    return;
  }

  const customer = user._id;
  console.log(`customer: ${String(user.name ?? '(no name)')}  ${String(customer)}\n`);

  const candidates: Candidate[] = [];

  // ---- bookings ------------------------------------------------------------
  const bookings = await db
    .collection<Row>(COLLECTIONS.bookings)
    .find({ customer })
    .sort({ createdAt: -1 })
    .limit(HOW_MANY)
    .toArray();

  console.log(`  BOOKINGS (${bookings.length})`);
  for (const b of bookings) {
    const status = String(b.status ?? '');
    const live = LIVE_BOOKING.includes(status);
    const label = `${String(b.occasion || b.title || 'Event')} · ${String(b.ref ?? '')}`;
    console.log(
      `    ${live ? '●' : '○'} ${date(b.eventDate)}  ${label.padEnd(38)} ${status}${live ? '' : '  (finished/cancelled)'}`,
    );
    if (live) {
      const stage =
        status === 'confirmed'
          ? 'booking_confirmed'
          : status === 'in_progress'
            ? 'in_progress'
            : 'booking_created';
      candidates.push({
        kind: 'booking',
        label,
        stage,
        rank: RANK[stage],
        id: String(b._id),
        planId: null,
        requestId: b.request ? String(b.request) : null,
      });
    }
  }
  if (bookings.length === 0) console.log('    none.');
  console.log('');

  // ---- briefs --------------------------------------------------------------
  const requests = await db
    .collection<Row>(COLLECTIONS.requests)
    .find({ customer })
    .sort({ createdAt: -1 })
    .limit(HOW_MANY)
    .toArray();

  console.log(`  BRIEFS (${requests.length})`);
  for (const r of requests) {
    const status = String(r.status ?? '');
    const live = LIVE_REQUEST.includes(status);
    const quotes = await db
      .collection<Row>(COLLECTIONS.quotations)
      .countDocuments({ request: r._id, status: { $nin: ['draft', 'withdrawn'] } });
    const recipients = ((r.recipients as unknown[] | undefined) ?? []).length;
    const label = String(r.occasion || 'Event');

    console.log(
      `    ${live ? '●' : '○'} ${date(r.createdAt)}  ${label.padEnd(38)} ${status}` +
        `  ${quotes} quote(s), sent to ${recipients}`,
    );
    if (live) {
      const stage =
        status === 'accepted' ? 'quote_accepted' : quotes > 0 ? 'quotes_received' : 'submitted';
      candidates.push({
        kind: 'brief',
        label,
        stage,
        rank: RANK[stage],
        id: String(r._id),
        planId: r.plan ? String(r.plan) : null,
        requestId: null,
      });
    }
  }
  if (requests.length === 0) console.log('    none.');
  console.log('');

  // ---- plans ---------------------------------------------------------------
  const plans = await db
    .collection<Row>(COLLECTIONS.plans)
    .find({ user: customer })
    .sort({ createdAt: -1 })
    .limit(HOW_MANY)
    .toArray();

  console.log(`  PLANS (${plans.length})`);
  for (const p of plans) {
    const status = String(p.status ?? '');
    const live = LIVE_PLAN.includes(status);
    const label = String(p.occasion || 'Event');
    console.log(`    ${live ? '●' : '○'} ${date(p.createdAt)}  ${label.padEnd(38)} ${status}`);
    if (live) {
      candidates.push({
        kind: 'plan',
        label,
        stage: status,
        rank: RANK[status],
        id: String(p._id),
        planId: null,
        requestId: null,
      });
    }
  }
  if (plans.length === 0) console.log('    none.');
  console.log('');

  // ---- what Home draws -----------------------------------------------------
  /*
   * CurrentEventService asks each module for ONE record — its latest live one —
   * and Home draws that set. The lists above are every live record the account
   * has, which is a different and much longer thing: an account with eight open
   * briefs does not get eight cards, it gets the newest brief.
   *
   * So the candidate set is narrowed the same way the service narrows it,
   * before anything is claimed about the screen.
   */
  const newest = (kind: Candidate['kind']): Candidate | null =>
    candidates.find((c) => c.kind === kind) ?? null; // lists are createdAt-desc

  const bookingPick = newest('booking');
  let briefPick = newest('brief');
  let planPick = newest('plan');

  const hidden: string[] = [];

  if (briefPick && bookingPick && bookingPick.requestId === briefPick.id) {
    hidden.push(`the brief "${briefPick.label}" is the booking ${bookingPick.label} — shown once`);
    briefPick = null;
  }
  if (briefPick && briefPick.stage === 'quote_accepted') {
    const booked = bookings.some((b) => b.request && String(b.request) === briefPick!.id);
    if (booked) {
      hidden.push(`the accepted brief "${briefPick.label}" already became a booking`);
      briefPick = null;
    }
  }
  if (planPick && briefPick && briefPick.planId === planPick.id) {
    hidden.push(`the plan behind "${briefPick.label}" is that brief — shown once`);
    planPick = null;
  }

  const shown = [bookingPick, briefPick, planPick]
    .filter((c): c is Candidate => c !== null)
    .sort((a, b) => b.rank - a.rank);

  console.log('  HOME WILL SHOW');
  if (shown.length === 0) {
    console.log('    The "start planning" hero — this account has nothing live.');
  } else {
    shown.forEach((c, i) => {
      const card =
        i === 0
          ? c.kind === 'booking'
            ? '← the BOOKED card'
            : '← the hero card'
          : '← its own hero below';
      console.log(`    ${i + 1}. ${c.label}  (${c.kind}, stage ${c.stage})  ${card}`);
    });
  }
  console.log('');

  if (hidden.length > 0) {
    console.log('  SHOWN ONCE, NOT TWICE');
    for (const h of hidden) console.log(`    ${h}`);
    console.log('');
  }

  /*
   * Everything else that is live. Home deliberately does not draw these — it
   * takes the newest of each kind — and they are reachable from the Events tab.
   * Printed because "why is my other brief not on Home" is the question this
   * script exists to answer.
   */
  const restedOut = candidates.filter((c) => !shown.includes(c));
  if (restedOut.length > 0) {
    console.log(`  LIVE, BUT NOT ON HOME (${restedOut.length})`);
    console.log('    Home takes only the newest booking, brief and plan. These are');
    console.log('    older live records, reachable from the Events tab:');
    for (const c of restedOut) {
      console.log(`      ${c.label.padEnd(38)} (${c.kind}, stage ${c.stage})`);
    }
    console.log('');
  }

  /* A brief that reached nobody still works — every organizer sees an
     unaddressed one — but it cannot say who it went to, and the hero then
     reports replies without a denominator. Worth knowing about. */
  const unaddressed = requests.filter(
    (r) =>
      LIVE_REQUEST.includes(String(r.status ?? '')) &&
      ((r.recipients as unknown[] | undefined) ?? []).length === 0,
  );
  if (unaddressed.length > 0) {
    console.log(`  BRIEFS THAT RECORDED NO RECIPIENTS (${unaddressed.length})`);
    console.log('    These went out before recipients were stored, or the matcher');
    console.log('    returned nobody. Every organizer can still see and quote them,');
    console.log('    but the card cannot say "went to N organizers".');
    console.log('');
  }

  await mongoose.disconnect();
}

main().catch((error: unknown) => {
  console.error('Could not check the home card:', (error as Error).message);
  process.exit(1);
});
