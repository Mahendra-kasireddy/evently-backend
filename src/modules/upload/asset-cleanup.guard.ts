/**
 * The rules for `npm run assets:cleanup` — what it may do, where.
 *
 *  - Report (the default) is read-only and allowed anywhere.
 *  - Deleting orphans needs `--delete` AND `--confirm=<cloud name>` (the
 *    Cloudinary cloud's name typed out, or `local` for the disk driver), and
 *    runs only with NODE_ENV=development or test, against a database whose URI
 *    does not look like production. There is no production path.
 *  - Retrying deletions the app already decided on needs `--retry-failed
 *    --yes`; in production it also needs `--allow-production`, since it
 *    deletes files there (each one is re-checked for references first).
 */
export interface CleanupArgs {
  delete: boolean;
  confirm: string;
  retryFailed: boolean;
  yes: boolean;
  allowProduction: boolean;
  scanCloudinary: boolean;
  minAgeHours: number;
  limit: number;
}

export interface CleanupEnv {
  NODE_ENV?: string;
  MONGO_URI?: string;
  CLOUDINARY_CLOUD_NAME?: string;
}

const DEFAULT_MIN_AGE_HOURS = 24;
const DEFAULT_LIMIT = 500;

export function parseCleanupArgs(argv: string[]): CleanupArgs {
  const value = (name: string): string | undefined => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : undefined;
  };
  const number = (name: string, fallback: number, min: number): number => {
    const n = Number(value(name));
    return Number.isFinite(n) && n >= min ? Math.floor(n) : fallback;
  };
  return {
    delete: argv.includes('--delete'),
    confirm: value('confirm') ?? '',
    retryFailed: argv.includes('--retry-failed'),
    yes: argv.includes('--yes'),
    allowProduction: argv.includes('--allow-production'),
    scanCloudinary: argv.includes('--scan-cloudinary'),
    minAgeHours: number('min-age-hours', DEFAULT_MIN_AGE_HOURS, 1),
    limit: number('limit', DEFAULT_LIMIT, 1),
  };
}

/** Throws with the reason when the requested run is not allowed. */
export function assertCleanupAllowed(args: CleanupArgs, env: CleanupEnv): void {
  if (args.delete && args.retryFailed) {
    throw new Error('Choose one: --delete or --retry-failed.');
  }
  const production = env.NODE_ENV === 'production';
  const prodLookingDb = /prod/i.test(env.MONGO_URI ?? '');

  if (args.delete) {
    if (production) {
      throw new Error('Refusing to delete orphaned files in production (NODE_ENV=production).');
    }
    if (env.NODE_ENV !== 'development' && env.NODE_ENV !== 'test') {
      throw new Error(
        'Deleting orphaned files needs NODE_ENV=development or test, set explicitly.',
      );
    }
    if (prodLookingDb) {
      throw new Error('Refusing to delete: MONGO_URI looks like a production database.');
    }
    const expected = env.CLOUDINARY_CLOUD_NAME || 'local';
    if (args.confirm !== expected) {
      throw new Error(`Deleting needs --confirm=${expected} (the storage you are deleting from).`);
    }
  }

  if (args.retryFailed) {
    if (!args.yes) throw new Error('Retrying deletions needs --yes.');
    if ((production || prodLookingDb) && !args.allowProduction) {
      throw new Error('Retrying deletions against production also needs --allow-production.');
    }
  }
}

/** What the run will do, in one line, for the header. */
export function describeRun(args: CleanupArgs): string {
  if (args.delete) return 'DELETE orphan candidates (each re-checked first)';
  if (args.retryFailed) return 'RETRY failed deletions (each re-checked first)';
  return 'report only — nothing is deleted';
}
