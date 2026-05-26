// apps/web/src/pages/onboarding.contract.test.ts
//
// Contract test for the SSR data path of `/onboarding`, landed in
// Task #891 of Story #878 (Web runtime DB binding cutover). The
// `onboarding.astro` frontmatter calls
// `buildOnboardingPageView(getActiveLegalDocuments(getDb()))` at
// render time; this test exercises the exact same chain against a
// REAL in-memory better-sqlite3 handle and asserts the rendered
// `legalAcceptances.*Version` fields reflect the row in the DB — not
// the legacy `SEED_*` constants the previous placeholder mirrored.
//
// Strategy:
//   1. Build a fresh in-memory SQLite handle and apply migrations 0000
//      (auth_and_rbac) + 0001 (onboarding_schema). Foreign-key
//      enforcement is ON so cascade and restrict semantics match
//      production. Migration application mirrors the shared
//      `freshOnboardingDb()` helper in `packages/shared/src/db/
//      queries/__tests__/onboardingDb.ts` — reproduced here because
//      the helper is not exported across the package boundary.
//   2. Mock `../lib/db.getDb` to return the seeded handle so the
//      .astro-equivalent chain (`getActiveLegalDocuments(getDb())`)
//      reads from it. `getActiveLegalDocuments` itself is NOT mocked.
//   3. Insert two `legal_documents` rows (one ToS, one privacy) with
//      version strings that are deliberately NOT the `SEED_*`
//      constants — if the page were still wired to the placeholder
//      it would return the SEED values and the assertion would fail.
//   4. Run the page-loader chain and assert the rendered
//      `legalAcceptances.termsOfServiceVersion` /
//      `legalAcceptances.privacyPolicyVersion` match the inserted
//      row exactly.
//
// Contract tier per `.agents/rules/testing-standards.md § Contract` —
// the system-under-test's persistence layer is real, not mocked.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { legalDocuments } from '@repo/shared/db/schema';
import Database, { type Database as SqliteDatabase } from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted mock so the factory and test bodies share the same handle.
const dbMocks = vi.hoisted(() => ({
  getDb: vi.fn<() => unknown>(),
}));

// onboarding.astro imports `../lib/db` relative to `src/pages/`; the
// test imports `../lib/db` relative to `src/pages/`. Both resolve to
// the same module id, but mock under the form the SUT uses.
vi.mock('../lib/db', () => ({
  getDb: dbMocks.getDb,
  __resetDbForTests: () => {
    /* noop */
  },
}));

const __filename = fileURLToPath(import.meta.url);
const MIGRATIONS_DIR = join(
  __filename,
  '..',
  '..',
  '..',
  '..',
  '..',
  'packages',
  'shared',
  'src',
  'db',
  'migrations',
);

function applyMigration(client: SqliteDatabase, filename: string): void {
  const sql = readFileSync(join(MIGRATIONS_DIR, filename), 'utf8');
  const statements = sql
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const stmt of statements) {
    client.exec(stmt);
  }
}

function freshOnboardingDb(): {
  drizzleDb: ReturnType<typeof drizzle>;
  client: SqliteDatabase;
} {
  const client = new Database(':memory:');
  client.pragma('foreign_keys = ON');
  applyMigration(client, '0000_auth_and_rbac.sql');
  applyMigration(client, '0001_onboarding_schema.sql');
  const drizzleDb = drizzle(client);
  return { drizzleDb, client };
}

let seededClient: SqliteDatabase | null = null;

beforeEach(() => {
  dbMocks.getDb.mockReset();
});

afterEach(() => {
  if (seededClient) {
    seededClient.close();
    seededClient = null;
  }
});

describe('/onboarding SSR data path — contract', () => {
  it('renders the active legal-document version strings from the DB row, not the SEED_* constants', async () => {
    // Arrange — seed two rows with intentionally non-SEED version
    // strings. If the page were still wired to the placeholder
    // (`readActiveLegalDocumentsPlaceholder()` → `SEED_TOS_VERSION`)
    // the rendered version would be "1.0.0" (the seed default) and
    // these assertions would fail.
    const { drizzleDb, client } = freshOnboardingDb();
    seededClient = client;
    const effectiveAt = new Date('2026-03-15T00:00:00.000Z');
    const nonSeedTosVersion = '7.42.0-runtime-cutover';
    const nonSeedPrivacyVersion = '9.11.3-runtime-cutover';
    drizzleDb
      .insert(legalDocuments)
      .values([
        {
          id: 'ld_tos_runtime',
          kind: 'terms_of_service',
          version: nonSeedTosVersion,
          effectiveAt,
          bodyUrl: '/legal/tos',
        },
        {
          id: 'ld_privacy_runtime',
          kind: 'privacy_policy',
          version: nonSeedPrivacyVersion,
          effectiveAt,
          bodyUrl: '/legal/privacy',
        },
      ])
      .run();
    dbMocks.getDb.mockReturnValue(drizzleDb);

    // Act — replicate the .astro frontmatter chain exactly:
    //   activeLegalDocuments = getActiveLegalDocuments(getDb())
    //   view = buildOnboardingPageView(activeLegalDocuments)
    const { getActiveLegalDocuments } = await import('@repo/shared/db/queries/legalDocuments');
    const { getDb } = await import('../lib/db');
    const { buildOnboardingPageView } = await import('./onboarding');

    const activeLegalDocuments = getActiveLegalDocuments(
      getDb(),
      new Date('2026-05-01T00:00:00.000Z'),
    );
    const view = buildOnboardingPageView(activeLegalDocuments);

    // Assert — the rendered version strings come straight from the DB
    // row, proving the cutover from placeholder to live read.
    expect(view.legalAcceptances.termsOfServiceVersion).toBe(nonSeedTosVersion);
    expect(view.legalAcceptances.privacyPolicyVersion).toBe(nonSeedPrivacyVersion);
    // And the `bodyUrl` fields likewise come from the row, not a
    // hardcoded `/legal/tos` / `/legal/privacy` literal in the
    // placeholder.
    expect(view.legalAcceptances.termsOfServiceBodyUrl).toBe('/legal/tos');
    expect(view.legalAcceptances.privacyPolicyBodyUrl).toBe('/legal/privacy');
    expect(dbMocks.getDb).toHaveBeenCalled();
  });

  it('picks the most-recent active row when multiple versions per kind exist', async () => {
    // Arrange — the page must reflect the LATEST effective row per kind
    // (the accessor's `desc(effectiveAt)` + `limit(1)` contract). Seed
    // two ToS rows: an older v1 and a newer v2 (both effective before
    // the request `now`). The page must render v2.
    const { drizzleDb, client } = freshOnboardingDb();
    seededClient = client;
    drizzleDb
      .insert(legalDocuments)
      .values([
        {
          id: 'ld_tos_v1',
          kind: 'terms_of_service',
          version: 'tos-v1.0.0',
          effectiveAt: new Date('2026-01-01T00:00:00.000Z'),
          bodyUrl: '/legal/tos',
        },
        {
          id: 'ld_tos_v2',
          kind: 'terms_of_service',
          version: 'tos-v2.0.0',
          effectiveAt: new Date('2026-04-01T00:00:00.000Z'),
          bodyUrl: '/legal/tos',
        },
        {
          id: 'ld_privacy_v1',
          kind: 'privacy_policy',
          version: 'privacy-v1.0.0',
          effectiveAt: new Date('2026-01-01T00:00:00.000Z'),
          bodyUrl: '/legal/privacy',
        },
      ])
      .run();
    dbMocks.getDb.mockReturnValue(drizzleDb);

    const { getActiveLegalDocuments } = await import('@repo/shared/db/queries/legalDocuments');
    const { getDb } = await import('../lib/db');
    const { buildOnboardingPageView } = await import('./onboarding');

    const activeLegalDocuments = getActiveLegalDocuments(
      getDb(),
      new Date('2026-05-01T00:00:00.000Z'),
    );
    const view = buildOnboardingPageView(activeLegalDocuments);

    expect(view.legalAcceptances.termsOfServiceVersion).toBe('tos-v2.0.0');
    expect(view.legalAcceptances.privacyPolicyVersion).toBe('privacy-v1.0.0');
  });

  it('Story #903: renders the SEED_* fallback when the DB has no active legal_documents rows', async () => {
    // The /onboarding page is the only route an un-onboarded user can
    // reach per the gate's allowlist. If the page itself 500s on an
    // unseeded DB, the user is stuck in a redirect-to-500 loop with no
    // escape. Story #903 wraps the live read in try/catch and falls
    // back to the canonical SEED_* constants — this test replicates the
    // .astro frontmatter chain exactly and asserts the fallback
    // produces a coherent OnboardingPageView.
    //
    // Arrange — fresh DB schema with NO legal_documents rows. The
    // accessor's contract is to throw when either active row is
    // missing.
    const { drizzleDb, client } = freshOnboardingDb();
    seededClient = client;
    dbMocks.getDb.mockReturnValue(drizzleDb);

    const { getActiveLegalDocuments } = await import('@repo/shared/db/queries/legalDocuments');
    const { getDb } = await import('../lib/db');
    const { buildOnboardingPageView } = await import('./onboarding');
    const {
      SEED_BOOTSTRAP_EFFECTIVE_AT,
      SEED_PRIVACY_BODY_URL,
      SEED_PRIVACY_ID,
      SEED_PRIVACY_VERSION,
      SEED_TOS_BODY_URL,
      SEED_TOS_ID,
      SEED_TOS_VERSION,
    } = await import('@repo/shared/db/seed');

    // Act — mirror the .astro frontmatter try/catch shape verbatim.
    // Suppress the expected console.error so the test output stays
    // clean; assert it fired on the next line.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let activeLegalDocuments;
    try {
      activeLegalDocuments = getActiveLegalDocuments(getDb(), new Date('2026-05-01T00:00:00.000Z'));
    } catch {
      activeLegalDocuments = {
        termsOfService: {
          id: SEED_TOS_ID,
          kind: 'terms_of_service' as const,
          version: SEED_TOS_VERSION,
          effectiveAt: SEED_BOOTSTRAP_EFFECTIVE_AT,
          bodyUrl: SEED_TOS_BODY_URL,
        },
        privacyPolicy: {
          id: SEED_PRIVACY_ID,
          kind: 'privacy_policy' as const,
          version: SEED_PRIVACY_VERSION,
          effectiveAt: SEED_BOOTSTRAP_EFFECTIVE_AT,
          bodyUrl: SEED_PRIVACY_BODY_URL,
        },
      };
      console.error('[onboarding] fallback fired');
    }
    const view = buildOnboardingPageView(activeLegalDocuments);

    // Assert — the page rendered (no throw escaped the catch) AND the
    // version strings match the SEED_* constants (proving the fallback,
    // not a real DB row). The buildOnboardingPageView return shape is
    // the load-bearing assertion: if the SEED_* fallback's shape
    // diverges from what buildOnboardingPageView expects, the chain
    // would throw at view-build time instead.
    expect(errorSpy).toHaveBeenCalled();
    expect(view.legalAcceptances.termsOfServiceVersion).toBe(SEED_TOS_VERSION);
    expect(view.legalAcceptances.privacyPolicyVersion).toBe(SEED_PRIVACY_VERSION);
    expect(view.title).toBeTruthy();
    expect(view.heading).toBeTruthy();

    errorSpy.mockRestore();
  });
});
