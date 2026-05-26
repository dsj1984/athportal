/**
 * @repo/shared/db/schema/rosterEntries — production Drizzle table.
 *
 * Epic #11 / Story #910 / Task #915. One row per athlete-on-this-team.
 * Created when a `roster_invite` is accepted (the accept handshake
 * inserts an `athlete_memberships` row and this row in the same
 * transaction). Soft-deleted via `ended_at` when the coach removes the
 * athlete from the roster — the audit history stays in place.
 *
 * Carries the team-scoped attributes the Epic introduces:
 *   - `jersey_number` is stored as `text` so leading zeros and "00"
 *     survive a round-trip. The DB-level CHECK constraint pins the
 *     grammar `^[0-9]{1,3}$`; the Zod schema in
 *     `@repo/shared/schemas/coach/roster.ts` enforces the same
 *     pattern at the API edge.
 *   - `primary_position` is free-text with client-side suggestions,
 *     capped server-side at 32 chars by the migration's CHECK.
 *
 * Cross-tenant integrity: every row's `org_id` MUST match the team's
 * `org_id` and the athlete user's `org_id`. Enforced by the
 * `roster_entry_cross_tenant_insert_check` / `_update_check` triggers
 * declared in migration 0007 and by `scopedDb(actor)` on every write.
 * Mirrors the trigger pattern established by `coachAssignments` /
 * `athleteMemberships`.
 *
 * Lifecycle: `ended_at` is nullable. `null` = active roster
 * membership. Set to `now()` to remove the athlete from the active
 * roster without deleting the row. The partial unique index
 * `roster_entry_team_athlete_active_unique` enforces that an athlete
 * appears on a team at most once while active; after `ended_at` is
 * set the pair can be reused (e.g. an athlete leaves and rejoins).
 */

import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { organizations } from './organizations';
import { teams } from './teams';
import { users } from './users';

export const rosterEntries = sqliteTable(
  'roster_entry',
  {
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
    // text-typed so leading zeros and "00" round-trip cleanly. The
    // migration's CHECK constraint pins the grammar `^[0-9]{1,3}$`.
    jerseyNumber: text('jersey_number'),
    // Free-text with client-side suggestions. The migration's CHECK
    // caps the server-side length at 32 chars.
    primaryPosition: text('primary_position'),
    // null = active membership. Set to `now()` to end-date without
    // deleting the audit row.
    endedAt: integer('ended_at', { mode: 'timestamp' }),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  },
  (table) => ({
    // Load-bearing for `scopedDb` prefixing every read with
    // `where org_id = :actor_org_id`. Composite with team_id matches
    // the coach roster page's primary query.
    orgTeamIdx: index('roster_entry_org_team_idx').on(table.orgId, table.teamId),
    // Composite for the roster list query: filter by team, then by
    // active/ended.
    teamEndedIdx: index('roster_entry_team_ended_idx').on(table.teamId, table.endedAt),
    // Partial unique index — an athlete is on a team at most once
    // while active. Reusable after `ended_at` is set.
    teamAthleteActiveUnique: uniqueIndex('roster_entry_team_athlete_active_unique')
      .on(table.teamId, table.athleteUserId)
      .where(sql`${table.endedAt} IS NULL`),
  }),
);

export type RosterEntry = typeof rosterEntries.$inferSelect;
export type NewRosterEntry = typeof rosterEntries.$inferInsert;
