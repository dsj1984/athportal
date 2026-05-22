/**
 * @repo/shared/db/schema/coachAssignments — production Drizzle table.
 *
 * N:N join between teams and coach users, introduced by Epic #9 /
 * Story #605. Carries a denormalized `org_id` so the query-layer
 * `scopedDb(actor)` helper (Story #607) can enforce cross-tenant
 * isolation by injecting `where org_id = actor.orgId` onto every read
 * and write without an extra JOIN.
 *
 * Cross-tenant integrity: every assignment row's `org_id` must match
 * both the team's `org_id` and the coach user's `org_id`. SQLite cannot
 * express that constraint cleanly as a multi-column FK, so the
 * migration (Story #609) adds a `CHECK` trigger and the `scopedDb`
 * helper enforces it in code on every insert.
 *
 * Lifecycle: `ended_at` is nullable. `null` means the assignment is
 * active; setting it to a timestamp end-dates the row without deleting
 * it (teams keep auditable history of coach changes).
 */

import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { organizations } from './organizations';
import { teams } from './teams';
import { users } from './users';

export const coachAssignments = sqliteTable('coach_assignments', {
  id: text('id').primaryKey(),
  orgId: text('org_id')
    .notNull()
    .references(() => organizations.id),
  teamId: text('team_id')
    .notNull()
    .references(() => teams.id),
  coachUserId: text('coach_user_id')
    .notNull()
    .references(() => users.id),
  // null = active assignment. Set to `now()` to end-date without
  // deleting the audit row.
  endedAt: integer('ended_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

export type CoachAssignment = typeof coachAssignments.$inferSelect;
export type NewCoachAssignment = typeof coachAssignments.$inferInsert;
