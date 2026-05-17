/**
 * echo.contract.test — sample round-trip contract test for the shared
 * test harness.
 *
 * This test exists to demonstrate the contract tier end-to-end against
 * the primitives shipped in Story #172:
 *
 *   1. `freshDb()` returns an isolated SQLite-backed Drizzle handle.
 *   2. `createTestApp(db)` builds a Hono app with the handle bound to
 *      `c.var.db`.
 *   3. A tiny inline `POST /echo` handler reads the request body, writes
 *      a row to the fixture `messages` table via Drizzle, and returns
 *      `{ ok: true, id: <rowId> }`.
 *   4. The test drives the handler with Hono's in-memory `app.request()`
 *      API (no real network) and asserts:
 *        a. HTTP status code,
 *        b. response JSON wire shape, and
 *        c. post-write DB row state.
 *
 * Feature Epics that need a round-trip contract test should copy this
 * file as a template. The three assertions above are the canonical
 * contract-tier triad — see docs/testing-strategy.md for tier rules.
 *
 * Story #178 / Task #190.
 */

import type { Database as SqliteDatabase } from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { type TestDb, createTestApp, freshDb } from '../index';
import { applyMessagesSchema, messages } from './fixtures/echo-schema';

/**
 * Reach into the better-sqlite3 client beneath a Drizzle handle to apply
 * the fixture schema. Drizzle's runtime exposes `$client` on the returned
 * object (see drizzle-orm/better-sqlite3 driver), but the harness's
 * `TestDb` alias is the structural BaseSQLiteDatabase shape and does not
 * declare it. This helper localizes the cast so the rest of the test
 * body stays typed.
 */
function applyFixtureSchema(db: TestDb, sql: string): void {
  const client = (db as TestDb & { $client: SqliteDatabase }).$client;
  client.exec(sql);
}

/**
 * Mount the inline `POST /echo` handler on a `createTestApp(db)` instance.
 *
 * Lives next to the test rather than in the harness because it is a
 * fixture, not part of the shipped surface.
 */
function mountEchoHandler(app: ReturnType<typeof createTestApp>): void {
  app.post('/echo', async (c) => {
    const payload: { body?: unknown } = await c.req.json();
    if (typeof payload.body !== 'string') {
      return c.json({ ok: false, error: 'body must be a string' }, 400);
    }
    const db = c.var.db;
    const inserted = db
      .insert(messages)
      .values({ body: payload.body })
      .returning({ id: messages.id })
      .all();
    const row = inserted[0];
    if (!row) {
      return c.json({ ok: false, error: 'insert returned no row' }, 500);
    }
    return c.json({ ok: true, id: row.id });
  });
}

describe('echo contract — round-trip status + wire shape + DB row', () => {
  it('returns 200, the right body, and persists the message', async () => {
    // Arrange
    const db = freshDb();
    applyFixtureSchema(db, applyMessagesSchema);
    const app = createTestApp(db);
    mountEchoHandler(app);

    // Act
    const res = await app.request('/echo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'hello, contract tier' }),
    });
    const body = (await res.json()) as { ok: boolean; id: number };

    // Assert — (a) HTTP status code
    expect(res.status).toBe(200);

    // Assert — (b) wire shape
    expect(body.ok).toBe(true);
    expect(typeof body.id).toBe('number');

    // Assert — (c) DB row state after write
    const persisted = db.select().from(messages).where(eq(messages.id, body.id)).all();
    expect(persisted).toHaveLength(1);
    expect(persisted[0]?.body).toBe('hello, contract tier');
  });

  it('produces a clean DB on every call (no state leakage between runs)', async () => {
    // Arrange — first run writes a row.
    const dbA = freshDb();
    applyFixtureSchema(dbA, applyMessagesSchema);
    const appA = createTestApp(dbA);
    mountEchoHandler(appA);
    await appA.request('/echo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'first run' }),
    });

    // Act — second `freshDb()` call must yield an empty messages table.
    const dbB = freshDb();
    applyFixtureSchema(dbB, applyMessagesSchema);

    // Assert — uniqueness of the underlying tmp file and empty state.
    expect(dbB.__filename).not.toBe(dbA.__filename);
    const rowsInB = dbB.select().from(messages).all();
    expect(rowsInB).toHaveLength(0);
  });
});
