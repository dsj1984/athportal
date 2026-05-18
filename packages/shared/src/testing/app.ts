/**
 * @repo/shared/testing/app — `createTestApp(db)` for contract tests.
 *
 * Returns a Hono application instance with the provided Drizzle handle
 * bound into request context under `c.var.db`. This matches the
 * composition pattern documented in docs/architecture.md §2 for
 * `@repo/api`: every route reads its DB from context rather than from a
 * module-level singleton, which lets contract tests inject an isolated
 * `freshDb()` per scenario.
 *
 * Today the test app exposes a single `/__test/health` route used by the
 * unit tests in this package to prove the binding works end-to-end. Once
 * `apps/api` lands real routers, callers can `.route('/api/v1/...', router)`
 * onto the returned app to wire production handlers against the test DB.
 *
 * Story #172 / Task #175.
 *
 * Story #342 / Task #356 — extend the signature with an optional
 * `{ actor }` option. When supplied, the test app mounts the test-auth
 * adapter that writes the supplied `AuthContext` into `c.var.auth` (and
 * `c.var.clerkSubjectId` for any downstream code that reads the raw
 * subject id). This swaps ONLY the JWT-validation stage — callers who
 * want to exercise `requireInternalUser`'s JIT path compose that
 * middleware themselves on the returned app. The `auth-test.ts` adapter
 * under `apps/api/src/middleware/__testing__/` is the API-side mirror
 * of this seam; both share the same load-bearing contract documented
 * in Tech Spec #318 §F.
 */

import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { Hono } from 'hono';
import type { TestDb } from './db';

/**
 * Structural shape of any better-sqlite3 Drizzle handle this harness
 * accepts. The legacy callers pass `TestDb` (the example test schema);
 * the test-auth seam in Story #342 / Task #357 passes a production-
 * schema handle (`{ users }` from `@repo/shared/db/schema`). Both are
 * `BetterSQLite3Database<TSchema>` for some `TSchema` — `TestDbLike`
 * unifies the two without forcing a single schema. `c.var.db` is only
 * read by downstream middleware, which narrows it structurally per the
 * `InternalUserDb` pattern in `apps/api/src/middleware/auth.ts`.
 */
// biome-ignore lint/suspicious/noExplicitAny: schema generic intentionally widened
export type TestDbLike = BetterSQLite3Database<any>;

/**
 * Canonical `AuthContext` shape mirrored from
 * `apps/api/src/middleware/auth.ts` (Story #330).
 *
 * Declared locally to keep `@repo/shared` free of dependencies on
 * `apps/api` — the package hierarchy runs `apps/api → packages/shared`,
 * never the other way round. Tech Spec #318 §F treats this declaration
 * and the API-side `AuthContext` as a versioned pair: a change to one
 * MUST land alongside a change to the other, gated by the contract
 * test in `apps/api/src/routes/v1/me.actor.contract.test.ts`.
 */
export interface AuthContext {
  readonly userId: string;
  readonly clerkSubjectId: string;
  readonly email: string;
  readonly role: string;
  readonly orgId: string | null;
  readonly teamId: string | null;
}

export interface TestAppBindings {
  Variables: {
    db: TestDbLike;
    clerkSubjectId: string;
    auth: AuthContext;
  };
}

export type TestApp = Hono<TestAppBindings>;

/**
 * Options accepted by `createTestApp`. `actor`, when supplied, drives
 * the test-auth seam: every request to the returned app sees
 * `c.var.auth === actor` and `c.var.clerkSubjectId === actor.clerkSubjectId`.
 *
 * The shape is intentionally minimal — additional knobs (e.g. dynamic
 * actor per request) belong in a follow-up Story rather than here.
 */
export interface CreateTestAppOptions {
  readonly actor?: AuthContext;
}

/**
 * Build a Hono app bound to the provided Drizzle handle.
 *
 * Use Hono's `app.request(path, init)` to drive HTTP calls in tests
 * without spinning up a real server.
 *
 * Overloads exist purely for callsite readability — both forms resolve
 * to the same implementation. The legacy single-arg form
 * (`createTestApp(db)`) remains the supported shape for callers that
 * do not need an authenticated actor.
 */
export function createTestApp(db: TestDbLike): TestApp;
export function createTestApp(db: TestDbLike, options: CreateTestAppOptions): TestApp;
export function createTestApp(db: TestDbLike, options: CreateTestAppOptions = {}): TestApp {
  const app = new Hono<TestAppBindings>();
  app.use('*', async (c, next) => {
    c.set('db', db);
    await next();
  });
  if (options.actor !== undefined) {
    const actor = options.actor;
    app.use('*', async (c, next) => {
      c.set('clerkSubjectId', actor.clerkSubjectId);
      c.set('auth', actor);
      await next();
    });
  }
  app.get('/__test/health', (c) => c.json({ ok: true }));
  return app;
}
