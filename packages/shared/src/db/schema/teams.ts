/**
 * @repo/shared/db/schema/teams — production Drizzle table.
 *
 * Skeleton table introduced by Epic #7 / Story #330. Carries the `org_id`
 * FK so `users.team_id` can be scoped to a team within an organization.
 * Epic #9 / Story #605 extended it with the nullable `deleted_at`
 * timestamp so soft-delete + 30-day recovery semantics are expressible
 * at the persistence layer. Epic #10 / Story #657 / Task #678 added the
 * team-management metadata columns (`sport`, `season`, `ageGroup`) and
 * the independent `archivedAt` timestamp the org-admin CRUD surface
 * toggles.
 *
 * `archivedAt` vs `deletedAt`:
 *   - `archivedAt` is a reversible workflow flag. Setting it hides the
 *     team from the default roster view; clearing it brings it back.
 *   - `deletedAt` is the soft-delete cleanup column from Epic #9. A
 *     cleanup job hard-deletes rows 30 days past this timestamp.
 *
 * A row can be archived without being deleted; the CRUD endpoints in
 * `apps/api/src/routes/v1/admin/teams.ts` only touch `archivedAt`.
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
  // Team-management metadata. Free-form text for now — a future Epic may
  // tighten `sport` and `ageGroup` to enums once the canonical
  // taxonomies are agreed.
  //
  // The columns are NOT NULL at the DB layer with a placeholder
  // `''` default so legacy fixtures (Epic #9 cross-tenant tests, etc.)
  // that insert teams without these fields keep working. Real callers
  // are gated by the Zod schema at `@repo/shared/schemas/admin/teams`
  // (POST/PATCH min(1) on each field) — the empty-string default is
  // not reachable from a production write path.
  sport: text('sport').notNull().default(''),
  season: text('season').notNull().default(''),
  ageGroup: text('age_group').notNull().default(''),
  // null = active. Set to `now()` via the archive endpoint; cleared via
  // restore. Independent of `deletedAt` — a team may be archived
  // without being deleted.
  archivedAt: integer('archived_at', { mode: 'timestamp' }),
  // null = active. Set to `now()` to soft-delete; a cleanup job
  // hard-deletes rows 30 days past this timestamp (out of scope here).
  deletedAt: integer('deleted_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

export type Team = typeof teams.$inferSelect;
export type NewTeam = typeof teams.$inferInsert;
