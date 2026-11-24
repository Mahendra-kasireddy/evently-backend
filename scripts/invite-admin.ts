/**
 * Invites a mobile number to the admin console from the server side.
 *
 *   npm run invite:admin -- 9876543210 "Your Name"
 *
 * Admin sign-up is invite-only, and invites are normally sent from the
 * console's Team page, by an admin. That leaves the very first admin with no
 * one to invite them: this script is that first invite. It only creates a
 * pending invite; the person still signs up on the console ("Sign up") and
 * proves the number with an OTP before the admin role is granted.
 *
 * Needs MONGO_URI, so only someone with access to the backend can run it.
 */
import 'dotenv/config';
import mongoose from 'mongoose';

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error('MONGO_URI is not set. Add it to .env first.');
  process.exit(1);
}

const args = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const phone = (args[0] ?? '').replace(/\D/g, '').slice(-10);
const name = (args.slice(1).join(' ') || 'Admin').trim().slice(0, 80);
if (phone.length !== 10) {
  console.error(
    'Pass a 10-digit mobile number, e.g.  npm run invite:admin -- 9876543210 "Ravi Kumar"',
  );
  process.exit(1);
}

const mask = (p: string) => `••••••${p.slice(-4)}`;

async function main(): Promise<void> {
  await mongoose.connect(MONGO_URI as string, {
    serverSelectionTimeoutMS: 8000,
    ...(process.env.MONGO_DB_NAME ? { dbName: process.env.MONGO_DB_NAME } : {}),
  });
  const db = mongoose.connection.db;
  if (!db) throw new Error('No database connection');

  const user = await db.collection('users').findOne({ phone }, { projection: { roles: 1 } });
  if ((user?.roles as string[] | undefined)?.includes('admin')) {
    console.log(`${mask(phone)} is already an admin — just sign in.`);
    return;
  }

  const invites = db.collection('admin_invites');
  if (await invites.findOne({ phone, status: 'pending' })) {
    console.log(
      `${mask(phone)} already has a pending invite — open the console and choose "Sign up".`,
    );
    return;
  }

  const now = new Date();
  await invites.insertOne({ phone, name, status: 'pending', createdAt: now, updatedAt: now });
  console.log(
    `Invited ${name} (${mask(phone)}). Open the admin console, choose "Sign up", and verify this number.`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => void mongoose.disconnect());
