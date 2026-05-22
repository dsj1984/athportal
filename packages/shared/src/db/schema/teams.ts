/**
 * @repo/shared/db/schema/teams — production Drizzle table.
 *
 * Skeleton table introduced by Epic #7 / Story #330. Carries the `org_id`
 * FK so `users.team_id` can be scoped to a team within an organization.
 * Epic #9 / Story #605 extended it with the nullable `deleted_at`
 * timestamp so soft-delete + 30-day recovery semantics are expressible
 * at the persistence layer. Full team management (members, roles,
 * invitations) is owned by later feature Epics.
 */

import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { organizations } from './organizations';

export const teams = sqliteTable('teams', {
  id: text('id').primaryKey(),
  orgId: text('org_id')
    .notNull()
    .references(() => organizations.id),
  name: text('name').notNull(),
  // null = active. Set to `now()` to soft-delete; a cleanup job
  // hard-deletes rows 30 days past this timestamp (out of scope here).
  deletedAt: integer('deleted_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

export type Team = typeof teams.$inferSelect;
export type NewTeam = typeof teams.$inferInsert;
