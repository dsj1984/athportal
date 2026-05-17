/**
 * @repo/shared/testing/__tests__/fixtures/echo-schema — fixture schema for
 * the round-trip contract test.
 *
 * This is a *test fixture*, not part of the shared package's public API.
 * It defines the tiny `messages` table that `echo.contract.test.ts`
 * writes into so the contract tier's end-to-end shape (status + wire
 * body + DB row) can be demonstrated against the shared harness.
 *
 * The production schema and the harness schema (users/resources) live
 * elsewhere — this fixture is intentionally isolated under `__tests__/`
 * so it is unreachable from production code paths.
 *
 * Story #178 / Task #190.
 */

import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const messages = sqliteTable('messages', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  body: text('body').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;

/**
 * Raw SQL to apply the messages fixture table to a `freshDb()` handle.
 *
 * `freshDb()` creates its own schema (users/resources) but does not know
 * about per-test fixture tables. Tests that need this fixture reach into
 * the underlying better-sqlite3 client via Drizzle's `$client` and run
 * this `CREATE TABLE` once per fresh handle.
 */
export const applyMessagesSchema = `
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
`;
