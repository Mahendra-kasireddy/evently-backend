/**
 * What the Home API actually returns for one customer.
 *
 * `check:home` reads the database and reasons about what Home *should* draw.
 * This one is the other half: it boots the real application against the real
 * database and calls the real `HomeService.getHomeFeed`, then prints the parts
 * of the payload the Home screen renders its event cards from.
 *
 * The two together separate the three places "my event is not on Home" can
 * come from — the data, the server, or the app:
 *
 *   check:home says it should show, check:feed shows it  → the app is stale;
 *                                                          reload the bundle.
 *   check:home says it should show, check:feed does not  → a server bug.
 *   check:home says it should not show                   → the data.
 *
 *   npm run check:feed 9876543210         # by phone
 *   npm run check:feed someone@email.com  # by email
 *
 * Read-only: it calls one GET-shaped service method and writes nothing.
 */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { AppModule } from '../src/app.module';
import { HomeService } from '../src/modules/home/home.service';

interface EventLike {
  title?: string;
  stage?: string;
  rank?: number;
  source?: string;
  refId?: string;
  quoteCount?: number;
  sentToCount?: number;
}

function describe(e: EventLike | null | undefined): string {
  if (!e) return '(none)';
  const bits = [
    `${e.title ?? '(untitled)'}`,
    `${e.source ?? '?'} · stage ${e.stage ?? '?'} · rank ${e.rank ?? '?'}`,
  ];
  if ((e.quoteCount ?? 0) > 0) bits.push(`${e.quoteCount} quote(s)`);
  return bits.join('  —  ');
}

async function main(): Promise<void> {
  const needle = (process.argv[2] ?? '').trim();
  if (!needle) {
    console.error('Give a phone or email: npm run check:feed 9876543210');
    process.exit(1);
  }

  // `error` only: a full boot log would bury the answer.
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error'],
  });

  try {
    const connection = app.get<Connection>(getConnectionToken());
    const db = connection.db;
    if (!db) throw new Error('No database handle');

    const user = await db
      .collection('users')
      .findOne({ $or: [{ phone: needle }, { mobile: needle }, { email: needle }] });

    if (!user) {
      console.log(`No user matched "${needle}".`);
      return;
    }

    const userId = String(user._id);
    console.log(`database: ${db.databaseName}`);
    console.log(`customer: ${String(user.name ?? '(no name)')}  ${userId}\n`);

    const feed = (await app.get(HomeService).getHomeFeed(userId)) as {
      booking?: { ref?: string; title?: string } | null;
      currentEvent?: EventLike | null;
      otherEvents?: EventLike[];
    };

    /*
     * `otherEvents` missing entirely — as opposed to present and empty — means
     * the process is running code from before it existed, which is the single
     * most likely reason a card that should be there is not.
     */
    const hasField = Object.prototype.hasOwnProperty.call(feed, 'otherEvents');

    console.log('  WHAT THE API RETURNS');
    console.log(
      `    booking      ${feed.booking ? `${feed.booking.title ?? ''} · ${feed.booking.ref ?? ''}` : '(none)'}`,
    );
    console.log(`    currentEvent ${describe(feed.currentEvent)}`);

    if (!hasField) {
      console.log('    otherEvents  FIELD ABSENT');
      console.log('');
      console.log('    This build predates `otherEvents`. The server is running older');
      console.log('    code than the source tree — restart it (and rebuild if you run');
      console.log('    from dist/).');
      return;
    }

    const others = feed.otherEvents ?? [];
    if (others.length === 0) {
      console.log('    otherEvents  none');
    } else {
      others.forEach((e, i) => console.log(`    otherEvents[${i}] ${describe(e)}`));
    }

    console.log('');
    console.log('  HOME WILL DRAW');
    const cards = [
      feed.booking
        ? `the BOOKED card for ${feed.booking.title ?? ''} · ${feed.booking.ref ?? ''}`
        : feed.currentEvent
          ? `the hero for ${feed.currentEvent.title ?? ''}`
          : null,
      ...others.map((e) => `a hero for ${e.title ?? ''}`),
    ].filter(Boolean);

    if (cards.length === 0) {
      console.log('    The "start planning" hero — nothing live.');
    } else {
      cards.forEach((c, i) => console.log(`    ${i + 1}. ${c}`));
      console.log('');
      console.log('    If the app shows fewer cards than this, the payload is right and');
      console.log('    the bundle is stale: reload the app (shake → Reload, or restart');
      console.log('    Metro with `npm start -- --reset-cache`).');
    }
    console.log('');
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error('Could not read the home feed:', (error as Error).message);
  process.exit(1);
});
