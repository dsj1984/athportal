/**
 * @repo/shared/db/schema/organizations — production Drizzle table.
 *
 * Skeleton table introduced by Epic #7 / Story #330 to serve as the FK
 * target for `users.org_id` and `teams.org_id`. Full schema (members,
 * invitations, billing, etc.) is owned by later feature Epics.
 *
 * Columns intentionally kept minimal — extend only via additive
 * migrations from the owning Epic.
 */

import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const organizations = sqliteTable('organizations', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;
