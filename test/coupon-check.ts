/**
 * Why is the coupon strip empty?
 *
 * Reads the coupons collection directly and re-runs, in the same order, every
 * condition `CouponService.listClaimable` applies. For each coupon it prints
 * either "SHOWN" or the first condition that ruled it out — so an empty strip
 * stops being a mystery and becomes a sentence.
 *
 *   npm run check:coupons
 *
 * Read-only. It opens the database this API is configured against and writes
 * nothing.
 */
import 'dotenv/config';
import mongoose from 'mongoose';

interface CouponRow {
  code: string;
  scope: string;
  status: string;
  startsAt: Date | null;
  endsAt: Date | null;
  usageLimit: number;
  usedCount: number;
  perCustomerLimit: number;
}

/** The first reason this coupon is not on a customer's home screen. */
function whyHidden(c: CouponRow, now: Date): string | null {
  if (c.scope !== 'platform') {
    return `scope is "${c.scope}" — organizer coupons appear at checkout, not on Home`;
  }
  if (c.status !== 'active') return `status is "${c.status}"`;
  if (c.startsAt && new Date(c.startsAt).getTime() > now.getTime()) {
    return `starts ${new Date(c.startsAt).toISOString()} — not yet`;
  }
  if (c.endsAt && new Date(c.endsAt).getTime() < now.getTime()) {
    return `ended ${new Date(c.endsAt).toISOString()}`;
  }
  if (c.usageLimit > 0 && c.usedCount >= c.usageLimit) {
    return `fully claimed (${c.usedCount}/${c.usageLimit})`;
  }
  return null;
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
  console.log(`database: ${db.databaseName}\n`);

  const rows = await db.collection<CouponRow>('coupons').find({}).toArray();
  if (rows.length === 0) {
    console.log('There are no coupons at all — the collection is empty.');
    console.log('Either none was saved, or this API points at a different database.');
    await mongoose.disconnect();
    return;
  }

  const now = new Date();
  let shown = 0;
  for (const row of rows) {
    const reason = whyHidden(row, now);
    if (reason) {
      console.log(`  HIDDEN  ${row.code.padEnd(16)} ${reason}`);
    } else {
      shown += 1;
      const limit = row.perCustomerLimit || 'unlimited';
      console.log(
        `  SHOWN   ${row.code.padEnd(16)} (still subject to each customer's own limit of ${limit})`,
      );
    }
  }

  console.log(`\n${shown} of ${rows.length} coupon(s) would reach the home strip.`);
  if (shown > 0) {
    console.log(
      'If the app still shows nothing, the API serving it is not running this build —\n' +
        'restart the backend, then reload the app (Metro: press r, or start it with --reset-cache).',
    );
  }
  await mongoose.disconnect();
}

main().catch((error: unknown) => {
  console.error('Could not check coupons:', (error as Error).message);
  process.exit(1);
});
