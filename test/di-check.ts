/**
 * Boots the whole Nest module graph with the database replaced by stubs.
 *
 * This exists because `tsc` cannot see dependency-injection wiring. A service
 * can be *provided* by a module and still be unreachable from another one —
 * Nest resolves an injection against the importing module's own context, so a
 * provider that is never exported compiles perfectly and then fails at boot
 * with "Nest can't resolve dependencies of X". That is exactly how
 * PlanConfigService reached HomeService: type-correct, and unresolvable.
 *
 * Run it with `npm run check:di`. It needs no database and no network: every
 * Mongoose model token is overridden with an empty object, so the only thing
 * being exercised is whether the graph can be constructed at all. It also
 * prints the routes it mapped, which catches a controller that was written but
 * never registered on its module.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { AppModule } from '../src/app.module';

const SRC = join(__dirname, '..', 'src');

/** Every file under a directory, recursively. */
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/**
 * Every model name Mongoose could be asked for.
 *
 * Two sources, because the codebase has both: classes declared in a
 * `*.schema.ts`, and string constants for the ref-only models that have no
 * class of their own (`CITY_REF_MODEL = 'OrganizerCityRef'`). Missing either
 * kind makes the check fail on a stub rather than on real wiring.
 */
function modelNames(): string[] {
  const files = walk(SRC).filter((f) => f.endsWith('.ts'));
  const names = new Set<string>();

  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    if (file.endsWith('.schema.ts')) {
      for (const m of source.matchAll(/export class (\w+)/g)) names.add(m[1]);
    }
    for (const m of source.matchAll(/MODEL = '(\w+)'/g)) names.add(m[1]);
  }
  return [...names];
}

async function main(): Promise<void> {
  const builder = Test.createTestingModule({ imports: [AppModule] });

  builder.overrideProvider(getConnectionToken()).useValue({
    readyState: 1,
    on: () => {},
    once: () => {},
    close: async () => {},
  });
  for (const name of modelNames()) {
    builder.overrideProvider(getModelToken(name)).useValue({});
  }

  let app: INestApplication | undefined;
  try {
    const moduleRef = await builder.compile();
    app = moduleRef.createNestApplication();
    await app.init();

    const router = (app.getHttpAdapter().getInstance() as { _router?: { stack?: unknown[] } })
      ._router;
    const routes = (router?.stack ?? [])
      .map((layer) => layer as { route?: { path: string; methods: Record<string, boolean> } })
      .filter((layer) => !!layer.route)
      .map((layer) => `${Object.keys(layer.route!.methods)[0].toUpperCase()} ${layer.route!.path}`);

    console.log(`DI OK — every module resolved, ${routes.length} routes mapped.`);
  } catch (error) {
    console.error('BOOT FAILED:', (error as Error).message.split('\n')[0]);
    process.exitCode = 1;
  } finally {
    // The stubbed connection cannot really be closed; a failure here says
    // nothing about the graph, so it must not mask a successful check.
    await app?.close().catch(() => {});
  }
}

void main();
