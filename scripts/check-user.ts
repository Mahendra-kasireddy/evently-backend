/**
 * Inspects the account(s) behind one mobile number, so you can see exactly what
 * exists rather than inferring it from the UI.
 *
 *   npm run check:user -- 9876543210
 *
 * Prints every user document whose phone matches those 10 digits (in any
 * format), the roles on each, any linked organizer profile, and how much
 * activity hangs off it. If more than one user document matches, that IS a
 * duplicate and the script says so loudly.
 *
 * Read-only: this script never writes.
 */
import 'dotenv/config';
import mongoose from 'mongoose';

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error('MONGO_URI is not set. Add it to .env first.');
  process.exit(1);
}

const raw = process.argv.slice(2).find((a) => !a.startsWith('-')) ?? '';
const digits = raw.replace(/\D/g, '').slice(-10);
if (digits.length !== 10) {
  console.error('Pass a 10-digit mobile number, e.g.  npm run check:user -- 9876543210');
  process.exit(1);
}

function redactedUri(uri: string): string {
  return uri.replace(/\/\/([^:]+):[^@]+@/, '//$1:***@');
}

async function main(): Promise<void> {
  try {
    await mongoose.connect(MONGO_URI as string, { serverSelectionTimeoutMS: 8000 });
  } catch {
    console.error(`Could not reach MongoDB at ${redactedUri(MONGO_URI as string)}`);
    process.exit(1);
  }
  const db = mongoose.connection.db;
  if (!db) throw new Error('No database handle after connect');

  console.log(`\ndatabase : ${db.databaseName}`);
  console.log(`number   : ${digits}\n`);

  // Match on the last 10 digits so a number stored as +91… or 0… is still found.
  const users = await db
    .collection('users')
    .find({ phone: { $regex: `${digits}$` } })
    .toArray();

  if (users.length === 0) {
    console.log('No user exists for that number.\n');
    await mongoose.disconnect();
    return;
  }

  for (const u of users) {
    const id = u._id;
    const profiles = await db.collection('organizer_profiles').find({ user: id }).toArray();
    const asCustomer = {
      quoteRequests: await db.collection('quote_requests').countDocuments({ customer: id }),
      bookings: await db.collection('bookings').countDocuments({ customer: id }),
      plans: await db.collection('plan_submissions').countDocuments({ user: id }),
    };
    const profileIds = profiles.map((p) => p._id);
    const asOrganizer = {
      quotations: profileIds.length
        ? await db.collection('quotations').countDocuments({ organizer: { $in: profileIds } })
        : 0,
      bookings: profileIds.length
        ? await db.collection('bookings').countDocuments({ organizer: { $in: profileIds } })
        : 0,
    };

    console.log('─'.repeat(64));
    console.log(`user id        : ${String(id)}`);
    console.log(`phone (stored) : ${String(u.phone)}`);
    console.log(`name / email   : ${String(u.name || '—')} / ${String(u.email || '—')}`);
    console.log(`roles          : ${JSON.stringify(u.roles)}`);
    console.log(`status         : ${String(u.status)}`);
    console.log(`created        : ${u.createdAt ? new Date(u.createdAt as string).toISOString() : '—'}`);
    console.log(`organizer profiles: ${profiles.length}`);
    for (const p of profiles) {
      console.log(
        `   • ${String(p._id)}  status=${String(p.onboardingStatus)}  completion=${String(p.profileCompletion ?? 0)}%  name=${String(p.name || p.businessName || '—')}`,
      );
    }
    console.log(
      `activity as customer : ${asCustomer.quoteRequests} quote requests, ${asCustomer.bookings} bookings, ${asCustomer.plans} plans`,
    );
    console.log(
      `activity as organizer: ${asOrganizer.quotations} quotations, ${asOrganizer.bookings} bookings`,
    );
  }
  console.log('─'.repeat(64));

  // ---- verdict ----
  if (users.length > 1) {
    console.log(`\n⚠  ${users.length} SEPARATE user documents share this number — that is a duplicate.`);
    console.log('   Stored values:', users.map((u) => String(u.phone)).join(', '));
    console.log('   The unique index only catches identical strings, so mixed formats slipped through.');
  } else {
    const u = users[0];
    const roles = (u?.roles as string[] | undefined) ?? [];
    const both = roles.includes('organizer') && roles.includes('customer');
    console.log(`\n✓ Exactly ONE account exists for this number (id ${String(u?._id)}).`);
    if (both) {
      console.log('  It holds BOTH roles: ["customer","organizer"] on the same user id.');
      console.log('  Nothing is duplicated — the organizer portal and the customer portal are');
      console.log('  two views of this one account. Registering as an organizer adds the role');
      console.log('  to the existing user ($addToSet); it never creates a second account.');
    } else {
      console.log(`  Roles: ${JSON.stringify(roles)}`);
    }
  }
  console.log('');
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('check failed:', err);
  process.exit(1);
});
