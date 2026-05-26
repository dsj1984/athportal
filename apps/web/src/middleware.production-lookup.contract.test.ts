// apps/web/src/middleware.production-lookup.contract.test.ts
//
// Contract test for the production-lookup ↔ DB boundary landed in
// Task #889 of Story #878. Mirrors the unit-tier test next door but
// exercises the wiring against a REAL in-memory better-sqlite3 instance
// with the production onboarding schema applied — no mocks for `getDb`
// or `getOnboardingState`. The point is to prove that the cutover from
// the legacy `() => null` placeholder to the real DB read actually
// causes a stamped user to flow past the gate, not just that the mocks
// line up.
//
// Strategy:
//   1. Build a fresh in-memory SQLite handle and apply migrations 0000
//      (auth_and_rbac) and 0001 (onboarding_schema). This is the same
//      bootstrap pattern the shared `freshOnboardingDb()` helper uses
//      in `packages/shared/src/db/queries/__tests__/onboardingDb.ts` —
//      reproduced here because that helper is not exported across the
//      package boundary.
//   2. Mock `./lib/db.getDb` to return the seeded handle so the
//      production lookup transparently reads it. `getOnboardingState`
//      is NOT mocked — the contract under test is precisely that the
//      sanctioned accessor sees the schema and returns the stamped row.
//   3. Drive a synthetic `GateContext` aimed at `/admin/teams` (a
//      protected, non-allowlisted path) through `createOnboardingGate
//      (productionLookup)` and assert `next()` runs, not `redirect`.
//
// Contract tier per `.agents/rules/testing-standards.md § Contract` —
// the system-under-test's persistence layer (sqlite + drizzle) is real,
// not mocked. Filename ends in `.contract.test.ts` so the `web-contract`
// project in `apps/web/vitest.config.ts` picks it up.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { users } from '@repo/shared/db/schema';
import Database, { type Database as SqliteDatabase } from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `astro:middleware` is a virtual module resolved by the Astro runtime.
// The per-workspace `apps/web/vitest.config.ts` aliases it to a shim
// for `web-unit` / `web-contract` runs, but the root workspace
// `contract` project (used by `npm run test:coverage`) does not — so
// stub the two functions the SUT actually imports.
vi.mock('astro:middleware', () => ({
  defineMiddleware: (fn: unknown) => fn,
  sequence: (...fns: ReadonlyArray<unknown>) => fns,
}));

// Module under test imports `./lib/db.getDb` at module-load time, so we
// mock it BEFORE the dynamic import inside each test. `vi.hoisted`
// shares the mock handle between the factory and the test bodies.
const dbMocks = vi.hoisted(() => ({
  getDb: vi.fn<() => unknown>(),
}));

vi.mock('../src/lib/db', () => ({
  getDb: dbMocks.getDb,
  __resetDbForTests: () => {
    /* noop */
  },
}));
// Astro/Vite alias resolution — match the relative form `./lib/db` too,
// because middleware.ts imports `./lib/db` (relative) and Vitest
// resolves that to a different cache key than `../src/lib/db`.
vi.mock('./lib/db', () => ({
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
  'packages',
  'shared',
  'src',
  'db',
  'migrations',
);

function applyMigration(client: SqliteDatabase, filename: string): void {
  const sql = readFileSync(join(MIGRATIONS_DIR, filename), 'utf8');
  // Drizzle migrations separate executable statements with the marker
  // `--> statement-breakpoint`. Split, trim, and run each one through
  // better-sqlite3's `.exec()` boundary.
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

interface RedirectCall {
  readonly path: string;
  readonly status?: number;
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

describe('productionLookup + onboarding gate — contract', () => {
  it('lets a stamped user reach /admin/teams (next() runs, no redirect to /onboarding)', async () => {
    // Arrange — fresh DB, insert an internal users row that has already
    // completed onboarding (both timestamps stamped).
    const { drizzleDb, client } = freshOnboardingDb();
    seededClient = client;
    const onboardedAt = new Date('2026-04-01T12:00:00.000Z');
    const ageAttestedAt = new Date('2026-04-01T12:00:05.000Z');
    drizzleDb
      .insert(users)
      .values({
        id: 'u_admin_42',
        clerkSubjectId: 'clerk_sub_admin_42',
        email: 'admin@example.invalid',
        role: 'admin',
        onboardedAt,
        ageAttestedAt,
      })
      .run();
    dbMocks.getDb.mockReturnValue(drizzleDb);

    const { createOnboardingGate, productionLookup } = await import('./middleware');
    const gate = createOnboardingGate(productionLookup);

    const redirectCalls: Array<RedirectCall> = [];
    let nextCalled = 0;
    const ctx = {
      url: new URL('https://app.example.invalid/admin/teams'),
      locals: { auth: () => ({ userId: 'u_admin_42' }) },
      redirect: (path: string, status?: number) => {
        redirectCalls.push({ path, status });
        return new Response(null, { status: status ?? 302, headers: { Location: path } });
      },
    };
    const next = () => {
      nextCalled += 1;
      return Promise.resolve(new Response(null, { status: 200 }));
    };

    // Act
    await gate(ctx, next);

    // Assert — the stamped user passes through; the gate must NOT 302.
    expect(nextCalled).toBe(1);
    expect(redirectCalls).toEqual([]);
  });

  it('302-redirects an un-onboarded user (onboarded_at IS NULL) to /onboarding', async () => {
    // Arrange — present users row, but onboarded_at is null.
    const { drizzleDb, client } = freshOnboardingDb();
    seededClient = client;
    drizzleDb
      .insert(users)
      .values({
        id: 'u_pending_99',
        clerkSubjectId: 'clerk_sub_pending_99',
        email: 'pending@example.invalid',
        role: 'member',
      })
      .run();
    dbMocks.getDb.mockReturnValue(drizzleDb);

    const { createOnboardingGate, productionLookup } = await import('./middleware');
    const gate = createOnboardingGate(productionLookup);

    const redirectCalls: Array<RedirectCall> = [];
    let nextCalled = 0;
    const ctx = {
      url: new URL('https://app.example.invalid/admin/teams'),
      locals: { auth: () => ({ userId: 'u_pending_99' }) },
      redirect: (path: string, status?: number) => {
        redirectCalls.push({ path, status });
        return new Response(null, { status: status ?? 302, headers: { Location: path } });
      },
    };
    const next = () => {
      nextCalled += 1;
      return Promise.resolve(new Response(null, { status: 200 }));
    };

    // Act
    await gate(ctx, next);

    // Assert — un-onboarded path is the safe default.
    expect(nextCalled).toBe(0);
    expect(redirectCalls).toEqual([{ path: '/onboarding', status: 302 }]);
  });
});
