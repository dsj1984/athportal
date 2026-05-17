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
 */

import { Hono } from 'hono';
import type { TestDb } from './db';

export interface TestAppBindings {
  Variables: {
    db: TestDb;
  };
}

export type TestApp = Hono<TestAppBindings>;

/**
 * Build a Hono app bound to the provided Drizzle handle.
 *
 * Use Hono's `app.request(path, init)` to drive HTTP calls in tests
 * without spinning up a real server.
 */
export function createTestApp(db: TestDb): TestApp {
  const app = new Hono<TestAppBindings>();
  app.use('*', async (c, next) => {
    c.set('db', db);
    await next();
  });
  app.get('/__test/health', (c) => c.json({ ok: true }));
  return app;
}
