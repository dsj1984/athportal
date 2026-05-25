// apps/api/src/middleware/withDb.contract.test.ts
//
// Pins the contract of the `withDb` middleware (Story #760):
//
//   1. Reads a Drizzle handle from `c.env.DB` and publishes it as
//      `c.var.db` for downstream handlers.
//   2. Throws synchronously when `c.env.DB` is absent, so a
//      misconfigured host fails loud at the first request rather than
//      surfacing a `TypeError: undefined is not a function` from a
//      downstream Drizzle call.
//
// Both cases run a minimal Hono app — no full production chain — so
// the assertions stay scoped to what the middleware itself promises.
// The end-to-end composition (clerkAuth → withDb → requireInternalUser
// → requireOnboarded → adminRoute) is covered by the existing
// `mount.contract.test.ts` and the per-admin-route contract tests.

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { type WithDbEnv, withDb } from './withDb';

function freshHandle(): unknown {
  // Ephemeral SQLite — no schema applied because the middleware does
  // not query, it only forwards the handle.
  return drizzle(new Database(':memory:'), { schema: {} });
}

describe('withDb middleware — contract', () => {
  it('publishes c.env.DB as c.var.db for downstream handlers', async () => {
    const handle = freshHandle();
    const app = new Hono<WithDbEnv>();
    app.use('*', withDb());
    app.get('/probe', (c) => {
      const fromVar = c.var.db;
      // The middleware promises identity, not a copy.
      return c.json({ same: fromVar === handle });
    });

    const res = await app.request('/probe', {}, { DB: handle });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ same: true });
  });

  it('throws when c.env.DB is undefined so a misconfigured host fails loud', async () => {
    const app = new Hono<WithDbEnv>();
    // Hono catches synchronous throws and surfaces them as 500s; the
    // assertion below pins that surface so a future regression cannot
    // silently swallow the binding gap.
    app.use('*', withDb());
    app.get('/probe', (c) => c.json({ ok: true }));

    // Cast to unknown — exercising the "missing binding" path means
    // deliberately passing the wrong env shape.
    // Pass an empty bindings object — Hono's request() signature accepts
    // `{} | Env`, so this is type-safe and exercises the "missing DB"
    // branch of the middleware.
    const res = await app.request('/probe', {}, {});

    expect(res.status).toBe(500);
  });
});
