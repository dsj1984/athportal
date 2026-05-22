/**
 * @repo/shared/db/schema/athleteMemberships — production Drizzle table.
 *
 * N:N join between teams and athlete users, introduced by Epic #9 /
 * Story #605. Mirrors the shape of `coachAssignments` so the query-layer
 * `scopedDb(actor)` helper (Story #607) can enforce cross-tenant
 * isolation uniformly across both join tables.
 *
 * Cross-tenant integrity: every membership row's `org_id` must match
 * both the team's `org_id` and the athlete user's `org_id`. SQLite
 * cannot express that constraint cleanly as a multi-column FK, so the
 * migration (Story #609) adds a `CHECK` trigger and the `scopedDb`
 * helper enforces it in code on every insert.
 *
 * Lifecycle: `ended_at` is nullable. `null` means the athlete is
 * currently on the roster; setting it to a timestamp removes them from
 * the active roster while preserving the audit row.
 */

import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { organizations } from './organizations';
import { teams } from './teams';
import { users } from './users';

export const athleteMemberships = sqliteTable('athlete_memberships', {
  id: text('id').primaryKey(),
  orgId: text('org_id')
    .notNull()
    .references(() => organizations.id),
  teamId: text('team_id')
    .notNull()
    .references(() => teams.id),
  athleteUserId: text('athlete_user_id')
    .notNull()
    .references(() => users.id),
  // null = active membership. Set to `now()` to end-date without
  // deleting the audit row.
  endedAt: integer('ended_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

export type AthleteMembership = typeof athleteMemberships.$inferSelect;
export type NewAthleteMembership = typeof athleteMemberships.$inferInsert;
