/**
 * @repo/shared/db/schema/teams — production Drizzle table.
 *
 * Skeleton table introduced by Epic #7 / Story #330. Carries the `org_id`
 * FK so `users.team_id` can be scoped to a team within an organization.
 * Full team management (members, roles, invitations) is owned by later
 * feature Epics.
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
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type Team = typeof teams.$inferSelect;
export type NewTeam = typeof teams.$inferInsert;
