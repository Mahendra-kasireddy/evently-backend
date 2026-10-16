/**
 * Puts the app's setup data into a database that does not have it yet — the
 * planner's and organizer registration's options (occasions, cities, service
 * categories, business types…) and the Home/Plan content.
 *
 * Usage:
 *   npm run seed:config          # dry run — lists what would be added
 *   npm run seed:config -- --yes # adds it
 *
 * Safe on production, by construction:
 *  - insert-only: a record that already exists (matched by its natural key)
 *    is left exactly as it is, so nothing an admin has edited is overwritten;
 *  - it never deletes anything;
 *  - no sample packages, sample organizers, demo users or demo bookings —
 *    those are in `npm run seed:demo`, which is for development only.
 */
import 'dotenv/config';
import mongoose from 'mongoose';

import { METADATA_TYPES } from '../src/modules/metadata/metadata.registry';
import { CONTENT_DEFAULTS } from '../src/modules/metadata/metadata.defaults';

const confirmed = process.argv.includes('--yes');

function redactedUri(uri: string): string {
  return uri.replace(/\/\/([^:]+):[^@]+@/, '//$1:***@');
}

async function main(): Promise<void> {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('MONGO_URI is not set. Add it to .env first.');
    process.exit(1);
  }
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  const db = mongoose.connection.db;
  if (!db) throw new Error('No database handle after connect');

  console.log(`\ndatabase : ${db.databaseName}`);
  console.log(`uri      : ${redactedUri(uri)}`);
  console.log(
    `mode     : ${confirmed ? 'ADD missing setup data' : 'dry run (pass --yes to add)'}\n`,
  );

  let toAdd = 0;
  for (const spec of METADATA_TYPES) {
    const coll = db.collection(spec.collection);
    let missing = 0;
    for (const doc of spec.defaults) {
      const key = doc[spec.keyField];
      const exists = await coll.findOne({ [spec.keyField]: key }, { projection: { _id: 1 } });
      if (exists) continue;
      missing += 1;
      if (confirmed) {
        const now = new Date();
        // $setOnInsert only: an existing record is never touched.
        await coll.updateOne(
          { [spec.keyField]: key },
          { $setOnInsert: { ...doc, createdAt: now, updatedAt: now } },
          { upsert: true },
        );
      }
    }
    toAdd += missing;
    const kept = spec.defaults.length - missing;
    console.log(
      `  ${spec.collection.padEnd(26)} ${confirmed ? 'added' : 'to add'} ${String(missing).padStart(3)}   kept ${kept}`,
    );
  }

  const content = db.collection('site_content');
  for (const [key, data] of Object.entries(CONTENT_DEFAULTS)) {
    const exists = await content.findOne({ key }, { projection: { _id: 1 } });
    if (exists) {
      console.log(`  site_content:${key.padEnd(13)} kept (already saved)`);
      continue;
    }
    toAdd += 1;
    if (confirmed) {
      const now = new Date();
      await content.updateOne(
        { key },
        { $setOnInsert: { key, data, createdAt: now, updatedAt: now } },
        { upsert: true },
      );
    }
    console.log(`  site_content:${key.padEnd(13)} ${confirmed ? 'added' : 'to add'}`);
  }

  console.log(
    confirmed
      ? `\ndone — ${toAdd} record(s) added; existing records untouched.\n`
      : `\nDry run — ${toAdd} record(s) would be added. Re-run with:  npm run seed:config -- --yes\n`,
  );
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('seed:config failed:', (err as Error)?.message ?? err);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
