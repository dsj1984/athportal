/**
 * @repo/shared/db/queries/coach/roster — coach-roster read queries.
 *
 * Epic #11 / Story #912 / Task #921. The two pure-Drizzle accessors
 * that back the coach-scoped roster surface:
 *
 *   - {@link listRosterEntries} — every active roster row on a team,
 *     joined to the athlete user row for `email` so the projection can
 *     render the "Athlete name + jersey + position" cells the coach
 *     roster page exposes.
 *   - {@link getTeamScopedAthlete} — one specific roster row by entry
 *     id, scoped to a single team, used by the team-scoped athlete
 *     profile page so jersey + position reflect the URL-bound team and
 *     not whichever other team the athlete also happens to be on.
 *
 * Tenancy defense (Tech Spec #906 §Authorization):
 *
 * The five graph tables wrapped by `scopedDb` (organizations, teams,
 * users, coachAssignments, athleteMemberships) are NOT a superset of
 * the roster surface — `rosterEntries` is its own table and its
 * org-scope predicate is enforced HERE, in the query layer, by pinning
 * `roster_entry.org_id = actor.orgId` in every WHERE clause. This is
 * the same defense-in-depth pattern used by `admin/roster.ts`: the
 * route layer's `requireCoachOnTeam(actor, teamId)` predicate refuses
 * the request when the actor is not on the team, and the query layer
 * pins org-id on every row so a coach who somehow forged a teamId
 * still cannot enumerate another tenant's roster.
 *
 * Both functions are pure relative to their `db` argument: they perform
 * exactly one read and return a typed row set. No mutation, no logging,
 * no Hono / HTTP type imports — the file's surface is structurally
 * verifiable by AC #2 ("Neither function imports Hono or any HTTP
 * type"), enforced by the unit test in `./roster.test.ts`.
 *
 * Active-only filter: `roster_entry.ended_at IS NULL` is part of every
 * read in this module. End-dated rows stay in place as the audit
 * history but never appear on a "current roster" surface. A future
 * Story that needs the audit-tail view will add a separate accessor
 * here rather than parameterizing this one — keeps the two intents
 * statically separable.
 */

import { type SQL, and, asc, eq, isNull, ne, sql } from 'drizzle-orm';
import { rosterEntries } from '../../schema/rosterEntries';
import { users } from '../../schema/users';

/**
 * Public projection of one roster row, joined to the athlete user.
 *
 * `athleteEmail` is the user's `email` column; `athleteFullName` is a
 * derived projection (the wire-shape schema in
 * `@repo/shared/schemas/coach/roster` carries this field). This module
 * surfaces only the joined columns it reads — name derivation is left
 * to the API edge so the query stays close to the persisted shape.
 */
export interface RosterEntryRow {
  readonly id: string;
  readonly orgId: string;
  readonly teamId: string;
  readonly athleteUserId: string;
  readonly athleteEmail: string;
  // Display-name identity promoted from Clerk into `users` at onboarding
  // (Story #1054 / F33). `null` when Clerk omitted the field; the API
  // edge falls back to the email-derived name when both are null.
  readonly athleteFirstName: string | null;
  readonly athleteLastName: string | null;
  readonly jerseyNumber: string | null;
  readonly primaryPosition: string | null;
  readonly endedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Minimal scope the queries need from the calling actor. Structural so
 * both the production `AuthContext` (from `apps/api/src/middleware/auth`)
 * and the `rbac/types` `AuthContext` (with optional `orgId`) satisfy
 * the type. `orgId` MUST be present — these queries refuse to run for
 * an actor with no tenant scope, the same way `scopedDb` refuses.
 */
export interface RosterQueryActor {
  readonly orgId: string;
}

/**
 * Structural shape of the Drizzle handle this module exercises. Mirrors
 * the pattern in `admin/roster.ts`: typed transparently — `select`
 * returns a builder we forward verbatim, with only the projection
 * columns and the joined row type pinned.
 *
 * The contract test in `apps/api/src/routes/v1/coach/roster.contract.test.ts`
 * supplies a real better-sqlite3 Drizzle handle; the unit test in
 * `./roster.test.ts` supplies a fresh schema handle from
 * `freshSchemaDb()`. Both satisfy this shape.
 */
interface RosterSelectChain {
  from: (table: typeof rosterEntries) => {
    innerJoin: (
      joined: typeof users,
      predicate: SQL,
    ) => {
      where: (predicate: SQL) => {
        orderBy: (...cols: SQL[]) => {
          all: () => RosterEntryRow[];
        };
        limit?: (n: number) => { all: () => RosterEntryRow[] };
      };
    };
  };
}

interface RosterDbHandle {
  select: (projection: Record<string, unknown>) => RosterSelectChain;
}

/**
 * Build the org-scope predicate. Combines `org_id = actor.orgId` with
 * any caller-supplied additional predicate via `and(...)`.
 *
 * Throws synchronously when the combination fails — drizzle's `and()`
 * widens to `SQL | undefined` for the empty-args case, which we never
 * hit (we always pass at least the scope predicate plus one filter).
 */
function combinePredicates(parts: SQL[]): SQL {
  const combined = and(...parts);
  if (!combined) {
    throw new Error('coach/roster: failed to combine WHERE predicates');
  }
  return combined;
}

/**
 * Return every active roster entry on `teamId`, scoped to the actor's
 * org. Rows where `ended_at IS NULL` only; ordered by creation time so
 * "first invited / accepted" appears first.
 *
 * The org-scope predicate is load-bearing — without it, a request that
 * presents a forged `teamId` from another tenant would still resolve
 * (because `coach_assignments` is checked by `requireCoachOnTeam` on
 * the actor's own org). Pinning `roster_entry.org_id = actor.orgId`
 * here closes that defense-in-depth gap.
 */
export function listRosterEntries(
  db: unknown,
  actor: RosterQueryActor,
  teamId: string,
): RosterEntryRow[] {
  const handle = db as RosterDbHandle;
  const predicate = combinePredicates([
    eq(rosterEntries.orgId, actor.orgId),
    eq(rosterEntries.teamId, teamId),
    isNull(rosterEntries.endedAt),
  ]);
  return handle
    .select({
      id: rosterEntries.id,
      orgId: rosterEntries.orgId,
      teamId: rosterEntries.teamId,
      athleteUserId: rosterEntries.athleteUserId,
      athleteEmail: users.email,
      athleteFirstName: users.firstName,
      athleteLastName: users.lastName,
      jerseyNumber: rosterEntries.jerseyNumber,
      primaryPosition: rosterEntries.primaryPosition,
      endedAt: rosterEntries.endedAt,
      createdAt: rosterEntries.createdAt,
      updatedAt: rosterEntries.updatedAt,
    })
    .from(rosterEntries)
    .innerJoin(users, eq(users.id, rosterEntries.athleteUserId))
    .where(predicate)
    .orderBy(asc(rosterEntries.createdAt))
    .all();
}

/**
 * Return one roster entry by id, scoped to the supplied team and the
 * actor's org. Returns `null` when the row does not exist, has been
 * end-dated, lives on a different team, or belongs to another tenant.
 *
 * The team-scoping is the whole point of this accessor: an athlete on
 * two teams has two `roster_entry` rows, each with its own jersey
 * number and primary position. The team-scoped athlete profile must
 * surface only the row whose `team_id` matches the URL — otherwise the
 * page would render the athlete's other team's jersey, which is the
 * exact bug AC #3 of Task #922 pins.
 */
export function getTeamScopedAthlete(
  db: unknown,
  actor: RosterQueryActor,
  teamId: string,
  entryId: string,
): RosterEntryRow | null {
  const handle = db as RosterDbHandle;
  const predicate = combinePredicates([
    eq(rosterEntries.orgId, actor.orgId),
    eq(rosterEntries.teamId, teamId),
    eq(rosterEntries.id, entryId),
    isNull(rosterEntries.endedAt),
  ]);
  const rows = handle
    .select({
      id: rosterEntries.id,
      orgId: rosterEntries.orgId,
      teamId: rosterEntries.teamId,
      athleteUserId: rosterEntries.athleteUserId,
      athleteEmail: users.email,
      athleteFirstName: users.firstName,
      athleteLastName: users.lastName,
      jerseyNumber: rosterEntries.jerseyNumber,
      primaryPosition: rosterEntries.primaryPosition,
      endedAt: rosterEntries.endedAt,
      createdAt: rosterEntries.createdAt,
      updatedAt: rosterEntries.updatedAt,
    })
    .from(rosterEntries)
    .innerJoin(users, eq(users.id, rosterEntries.athleteUserId))
    .where(predicate)
    .orderBy(asc(rosterEntries.createdAt))
    .all();
  return rows[0] ?? null;
}

// ── Mutations (Story #917 / Task #924) ─────────────────────────────────────

/**
 * Structural shape of the Drizzle `update(table)` chain this module uses.
 * Kept tiny so the test handles (in-memory better-sqlite3) and the
 * production handle satisfy it without explicit casts at the call sites.
 */
interface RosterUpdateChain {
  set: (values: Record<string, unknown>) => {
    where: (predicate: SQL) => {
      returning: () => { all: () => RosterEntryRow[] };
    };
  };
}

interface RosterMutateDbHandle extends RosterDbHandle {
  update: (table: typeof rosterEntries) => RosterUpdateChain;
}

interface RosterCountSelectChain {
  from: (table: typeof rosterEntries) => {
    where: (predicate: SQL) => {
      all: () => ReadonlyArray<{ readonly count: number }>;
    };
  };
}

interface RosterCountDbHandle {
  select: (projection: Record<string, unknown>) => RosterCountSelectChain;
}

/**
 * Patch input. Both fields are independently optional; the route layer's
 * `EditRosterEntryInput` Zod schema rejects empty patches before they
 * reach this function. `null` clears the column.
 */
export interface UpdateRosterEntryPatch {
  readonly jerseyNumber?: string | null;
  readonly primaryPosition?: string | null;
}

/**
 * Apply a coach-scoped PATCH to one roster entry. Org + team + active
 * predicates are pinned in the WHERE clause so the update refuses to
 * touch:
 *
 *   - another tenant's row (cross-org via forged `entryId`),
 *   - a row on another team in the same org (cross-team via forged
 *     `entryId`),
 *   - a row that has been end-dated (idempotency: DELETE then PATCH
 *     resolves to a no-op rather than a resurrect).
 *
 * Returns the updated row, or `null` when no row matched. `updatedAt`
 * is bumped on every write — the column has a default at insert time
 * only.
 */
export function updateRosterEntry(
  db: unknown,
  actor: RosterQueryActor,
  teamId: string,
  entryId: string,
  patch: UpdateRosterEntryPatch,
): RosterEntryRow | null {
  const handle = db as RosterMutateDbHandle;
  const predicate = combinePredicates([
    eq(rosterEntries.orgId, actor.orgId),
    eq(rosterEntries.teamId, teamId),
    eq(rosterEntries.id, entryId),
    isNull(rosterEntries.endedAt),
  ]);
  const values: Record<string, unknown> = {
    updatedAt: sql`(unixepoch())`,
  };
  if (patch.jerseyNumber !== undefined) {
    values.jerseyNumber = patch.jerseyNumber;
  }
  if (patch.primaryPosition !== undefined) {
    values.primaryPosition = patch.primaryPosition;
  }
  const rows = handle.update(rosterEntries).set(values).where(predicate).returning().all();
  if (rows.length === 0) return null;
  // The `RETURNING *` shape includes every column but not the joined
  // athlete email. Re-read through the existing accessor so callers
  // get the consistent `RosterEntryRow` shape (email + projection).
  return getTeamScopedAthlete(db, actor, teamId, entryId);
}

/**
 * Soft-delete a roster entry by setting `ended_at = now()`. Scoped the
 * same way as {@link updateRosterEntry}. Idempotent: re-running on an
 * already-ended row matches zero rows and returns `false`, which the
 * route layer treats as "already removed" (HTTP 204 either way).
 *
 * Returns `true` when a row was end-dated by this call; `false` when
 * no row matched (already ended, wrong team, wrong org, or
 * non-existent).
 */
export function endRosterEntry(
  db: unknown,
  actor: RosterQueryActor,
  teamId: string,
  entryId: string,
): boolean {
  const handle = db as RosterMutateDbHandle;
  const predicate = combinePredicates([
    eq(rosterEntries.orgId, actor.orgId),
    eq(rosterEntries.teamId, teamId),
    eq(rosterEntries.id, entryId),
    isNull(rosterEntries.endedAt),
  ]);
  const rows = handle
    .update(rosterEntries)
    .set({
      endedAt: sql`(unixepoch())`,
      updatedAt: sql`(unixepoch())`,
    })
    .where(predicate)
    .returning()
    .all();
  return rows.length > 0;
}

/**
 * Probe for another active roster entry on the same team carrying the
 * same `jerseyNumber`. Returns `true` when a collision exists — the
 * route layer surfaces this as a SOFT warning in the PATCH response
 * (Tech Spec #906 §UX Behaviors). No DB-level unique constraint
 * enforces uniqueness because two athletes legitimately can share a
 * number across leagues; the coach decides whether to fix it.
 *
 * `exceptEntryId` excludes the row currently being edited so that a
 * coach who PATCHes the same row twice doesn't see the warning on the
 * second write.
 */
export function jerseyNumberInUse(
  db: unknown,
  actor: RosterQueryActor,
  teamId: string,
  jerseyNumber: string,
  exceptEntryId: string,
): boolean {
  const handle = db as RosterCountDbHandle;
  const predicate = combinePredicates([
    eq(rosterEntries.orgId, actor.orgId),
    eq(rosterEntries.teamId, teamId),
    eq(rosterEntries.jerseyNumber, jerseyNumber),
    ne(rosterEntries.id, exceptEntryId),
    isNull(rosterEntries.endedAt),
  ]);
  const rows = handle
    .select({ count: sql<number>`count(*)`.as('count') })
    .from(rosterEntries)
    .where(predicate)
    .all();
  const first = rows[0];
  return first !== undefined && first.count > 0;
}
