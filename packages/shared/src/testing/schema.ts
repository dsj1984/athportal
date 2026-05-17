/**
 * @repo/shared/testing/schema — example Drizzle schema for the test harness.
 *
 * Story #172 ships the test harness BEFORE the production domain schema
 * lands (per docs/architecture.md §2, `packages/shared/src/db/schema/**`
 * is added as Epics accrete). This module supplies a minimal Drizzle
 * schema (`users`, `resources`) that:
 *
 *   1. Lets the harness primitives (`freshDb`, `seedUser`, `seedResource`)
 *      be exercised by unit tests today.
 *   2. Acts as a placeholder consumers can import via `@repo/shared/testing`
 *      until the real schema lands, at which point this module is the
 *      single switch-point — `freshDb()` will run the project's real
 *      migration set instead.
 *
 * Production code MUST NOT import this module. It is reachable only via
 * the `@repo/shared/testing` subpath, which is consumed by tests only.
 */

import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    clerkId: text('clerk_id').notNull(),
    email: text('email').notNull(),
    role: text('role').notNull().default('org_admin'),
    onboardedAt: integer('onboarded_at', { mode: 'timestamp' }),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  },
  (table) => ({
    clerkIdUnique: uniqueIndex('users_clerk_id_unique').on(table.clerkId),
    emailUnique: uniqueIndex('users_email_unique').on(table.email),
  }),
);

export const resources = sqliteTable('resources', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id')
    .notNull()
    .references(() => users.id),
  name: text('name').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

export const schema = { users, resources };

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Resource = typeof resources.$inferSelect;
export type NewResource = typeof resources.$inferInsert;
