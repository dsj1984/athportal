/**
 * @repo/shared/db/seed — minimal legal-documents seed for onboarding.
 *
 * Introduced by Epic #8 / Story #555 / Task #565. Tech Spec #490.
 *
 * The onboarding handler refuses to operate against a workspace that has
 * no active Terms-of-Service or Privacy-Policy row (see
 * `getActiveLegalDocuments` — it throws when either kind is missing).
 * This seed establishes exactly one active row per kind so local-dev,
 * contract tests, and bootstrapped preview environments can run the
 * onboarding flow.
 *
 * Idempotence — `seedLegalDocuments` uses Drizzle's
 * `onConflictDoNothing` on the `legal_documents.id` primary key, so
 * re-running the seed (CI loops, dev reload) leaves the existing rows
 * untouched. The seed is INTENTIONALLY minimal at first introduction;
 * future legal-document changes ship via Drizzle migrations and a
 * separate row-insertion path. Per the data-dictionary policy, seed
 * data is "never modified without explicit approval" — extending this
 * file requires a Tech-Spec amendment.
 */

import { legalDocuments } from './schema/legalDocuments';

/**
 * The bootstrap `effective_at` timestamp for the seeded rows. Pinned to
 * a calendar date (not "now") so re-running the seed produces a
 * byte-stable row in `effective_at`, and so contract tests can assert
 * against a deterministic value without fake-timers boilerplate.
 */
export const SEED_BOOTSTRAP_EFFECTIVE_AT = new Date('2026-01-01T00:00:00.000Z');

export const SEED_TOS_ID = 'seed_tos_2026_01_01' as const;
export const SEED_PRIVACY_ID = 'seed_privacy_2026_01_01' as const;
export const SEED_TOS_VERSION = '2026-01-01' as const;
export const SEED_PRIVACY_VERSION = '2026-01-01' as const;

interface InsertChain {
  insert: (table: typeof legalDocuments) => {
    values: (rows: Array<typeof legalDocuments.$inferInsert>) => {
      onConflictDoNothing: () => { run: () => unknown };
    };
  };
}

/**
 * Insert the bootstrap ToS and Privacy-Policy rows. Idempotent — calling
 * this twice produces no duplicate rows.
 *
 * The caller owns the DB handle (production Worker `@libsql/client` or
 * better-sqlite3 in tests). The function uses Drizzle's
 * `onConflictDoNothing` on the primary key so the second run is a
 * silent no-op.
 */
export function seedLegalDocuments(db: unknown): void {
  const handle = db as InsertChain;
  handle
    .insert(legalDocuments)
    .values([
      {
        id: SEED_TOS_ID,
        kind: 'terms_of_service',
        version: SEED_TOS_VERSION,
        effectiveAt: SEED_BOOTSTRAP_EFFECTIVE_AT,
        bodyUrl: 'https://athportal.example.invalid/legal/terms-of-service/2026-01-01',
      },
      {
        id: SEED_PRIVACY_ID,
        kind: 'privacy_policy',
        version: SEED_PRIVACY_VERSION,
        effectiveAt: SEED_BOOTSTRAP_EFFECTIVE_AT,
        bodyUrl: 'https://athportal.example.invalid/legal/privacy-policy/2026-01-01',
      },
    ])
    .onConflictDoNothing()
    .run();
}
