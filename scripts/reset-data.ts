/**
 * Wipes the application's *data* so you can start creating your own, while
 * leaving every reference/config collection in place — cities, occasions,
 * service categories, packages and site content — so the app still boots and
 * the planner still has options to offer.
 *
 * Usage:
 *   npm run reset:data            # dry run — prints what WOULD be deleted
 *   npm run reset:data -- --yes   # actually deletes
 *
 * Guards: refuses to run when MONGO_URI looks like production, and always
 * prints the target database and per-collection counts before touching
 * anything. `deleteMany` is used rather than dropping collections, so indexes
 * (including the unique ones on user phone/email) survive intact.
 *
 * NOTE: after this, do NOT run `npm run seed` unless you want the demo user,
 * demo organizers, demo booking, notifications and quotes back — this script
 * deliberately leaves the config that `seed` also owns, so a re-seed is not
 * needed just to make the app work.
 */
import 'dotenv/config';
import mongoose from 'mongoose';

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error('MONGO_URI is not set. Add it to .env first.');
  process.exit(1);
}

/** Everything that represents accounts, events and their activity. */
const CLEAR: Array<{ name: string; what: string }> = [
  { name: 'bookings', what: 'confirmed events, their tasks and timelines' },
  { name: 'quotations', what: 'organizer quotes (incl. drafts)' },
  { name: 'quote_requests', what: 'customer quote requests' },
  { name: 'invitations', what: 'guest invitations' },
  { name: 'plan_submissions', what: 'planner submissions and drafts' },
  { name: 'events', what: 'event records' },
  { name: 'notifications', what: 'in-app notifications' },
  { name: 'academy_progress', what: 'organizer academy progress' },
  { name: 'subvendor_links', what: 'organizer ↔ sub-vendor links' },
  { name: 'subvendor_profiles', what: 'sub-vendor profiles' },
  { name: 'otps', what: 'pending one-time codes' },
  { name: 'organizer_profiles', what: 'ALL organizer profiles (incl. seeded demo ones)' },
  { name: 'users', what: 'ALL user accounts' },
];

/** Reference/config the app needs in order to function. Never touched. */
const KEEP = [
  'site_content',
  'packages',
  'plan_cities',
  'plan_occasions',
  'plan_service_categories',
  'plan_guest_ranges',
  'plan_budget_ranges',
  'business_types',
  'organizer_categories',
  'experience_ranges',
  'team_sizes',
  'languages',
  'travel_options',
  'payment_methods',
  'working_days',
  'document_types',
];

const confirmed = process.argv.includes('--yes');

function redactedUri(uri: string): string {
  return uri.replace(/\/\/([^:]+):[^@]+@/, '//$1:***@');
}

async function main(): Promise<void> {
  if (/prod/i.test(MONGO_URI as string)) {
    console.error('Refusing to run: MONGO_URI looks like a production database.');
    console.error(`  ${redactedUri(MONGO_URI as string)}`);
    process.exit(1);
  }

  try {
    await mongoose.connect(MONGO_URI as string, { serverSelectionTimeoutMS: 8000 });
  } catch {
    console.error(`Could not reach MongoDB at ${redactedUri(MONGO_URI as string)}`);
    console.error('Check that the server is running and that your IP is allowed. Nothing was changed.');
    process.exit(1);
  }
  const db = mongoose.connection.db;
  if (!db) throw new Error('No database handle after connect');

  console.log(`\ndatabase : ${db.databaseName}`);
  console.log(`uri      : ${redactedUri(MONGO_URI as string)}`);
  console.log(`mode     : ${confirmed ? 'DELETE' : 'dry run (pass --yes to delete)'}\n`);

  const existing = new Set((await db.listCollections().toArray()).map((c) => c.name));

  // ---- what will go ----
  console.log('to clear:');
  let total = 0;
  const counts = new Map<string, number>();
  for (const { name, what } of CLEAR) {
    const n = existing.has(name) ? await db.collection(name).countDocuments() : 0;
    counts.set(name, n);
    total += n;
    const missing = existing.has(name) ? '' : '  (no such collection)';
    console.log(`  ${name.padEnd(20)} ${String(n).padStart(6)}  ${what}${missing}`);
  }
  console.log(`  ${'TOTAL'.padEnd(20)} ${String(total).padStart(6)} documents\n`);

  // ---- what stays ----
  console.log('keeping (reference/config):');
  for (const name of KEEP) {
    const n = existing.has(name) ? await db.collection(name).countDocuments() : 0;
    console.log(`  ${name.padEnd(28)} ${String(n).padStart(6)}`);
  }
  console.log('');

  if (!confirmed) {
    console.log('Dry run only — nothing was deleted. Re-run with:  npm run reset:data -- --yes\n');
    await mongoose.disconnect();
    return;
  }

  let deleted = 0;
  for (const { name } of CLEAR) {
    if (!existing.has(name)) continue;
    const res = await db.collection(name).deleteMany({});
    deleted += res.deletedCount ?? 0;
    console.log(`✓ cleared ${name} (${res.deletedCount ?? 0})`);
  }

  console.log(`\ndone — ${deleted} documents removed from ${db.databaseName}.`);
  console.log('Indexes and config collections are untouched. Sign up fresh to create your first account.\n');
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('reset failed:', err);
  process.exit(1);
});
