/**
 * Idempotent seed script. Run with: npm run seed
 *
 * Populates the collections that back the customer home screen with the same
 * content that used to be hard-coded in the frontend. Re-running replaces the
 * seeded documents (matched by a stable natural key), so it's safe to repeat.
 */
import 'dotenv/config';
