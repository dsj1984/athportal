/**
 * @repo/shared/rbac/coachOnTeam — authorization predicate for the
 * coach-owned roster surface (Epic #11 / Story #910 / Task #913).
 *
 * Tech Spec #906 §Authorization predicate nominates this helper as the
 * single load-bearing authorization surface for every coach roster
 * route: `requireCoachOnTeam(actor, teamId, db)` MUST be called BEFORE
 * any roster query touches the database. Pairs with `scopedDb(actor)`
 * which enforces the "row even belongs to this org" half of the
 * cross-tenant defense.
 *
 * The helper throws an `HttpError` with status `404` (not `403`) when
 * the actor does not actively coach the named team. A `403` would
 * confirm the team's existence to an attacker; a `404` returns the same
 * shape whether the team doesn't exist or the actor isn't on it.
 *
 * "Active" means the matching `coach_assignments` row has
 * `ended_at IS NULL`. Ended assignments are explicitly refused — the
 * audit row stays in place but the predicate behaves as if the actor
 * never coached the team.
 *
 * Pure relative to its `db` argument: the helper performs exactly one
 * read and either returns `void` or throws. No mutation, no logging
 * with PII.
 */

import { and, eq, isNull } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { coachAssignments } from '../db/schema/coachAssignments';
import type { AuthContext } from './types';

/**
 * Minimal HTTP error class colocated with the helper that throws it.
 *
 * The framework does not yet ship a shared `HttpError` (Tech Spec
 * #906 §API Changes nominates a future error envelope but does not
 * gate this Story on it). Re-using the existing `Error` shape with an
 * extra `status` property keeps the call-site contract typed and
 * lets downstream Hono middleware map status -> HTTP response without
 * a separate try/catch ladder per error class.
 */
export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

/**
 * Structural shape of the Drizzle handle this helper needs. Accepting a
 * subset of the Drizzle surface (the chained `select.from.where.limit`
 * builder) keeps unit tests free of better-sqlite3 — a hand-rolled stub
 * that returns rows from an in-memory array satisfies the type.
 *
 * Production callers pass `BetterSQLite3Database` or an equivalent
 * Drizzle handle; both shapes satisfy the structural typing below.
 */
export type CoachOnTeamDb = BetterSQLite3Database<Record<string, never>> | DrizzleSelectShape;

/**
 * Structural shape sufficient for the single query this helper issues.
 * Exported as a named interface so test doubles can declare a type
 * alias rather than relying on `as never`.
 */
export interface DrizzleSelectShape {
  select(columns: { id: typeof coachAssignments.id }): {
    from(table: typeof coachAssignments): {
      where(predicate: ReturnType<typeof and>): {
        limit(n: number): Promise<Array<{ id: string }>>;
      };
    };
  };
}

/**
 * Refuse the request unless `actor` has an active coach assignment on
 * `teamId`. Throws `HttpError(404, 'team-not-found')` on every refused
 * case — the same payload whether the team doesn't exist, the actor is
 * on a different team, the actor isn't a coach, or the actor's
 * assignment has been ended.
 *
 * @param actor — populated by `requireInternalUser` upstream. The
 *                helper reads `actor.userId` and matches it against
 *                `coach_assignments.coach_user_id`.
 * @param teamId — the team the caller is attempting to act on.
 * @param db — Drizzle handle (the unscoped one — this helper deliberately
 *             reads across the actor's own org to avoid double-filtering;
 *             `scopedDb` provides the org-level defense at the query layer
 *             below this predicate).
 */
export async function requireCoachOnTeam(
  actor: AuthContext,
  teamId: string,
  db: CoachOnTeamDb,
): Promise<void> {
  const rows = await db
    .select({ id: coachAssignments.id })
    .from(coachAssignments)
    .where(
      and(
        eq(coachAssignments.coachUserId, actor.userId),
        eq(coachAssignments.teamId, teamId),
        isNull(coachAssignments.endedAt),
      ),
    )
    .limit(1);

  if (rows.length === 0) {
    throw new HttpError(404, 'team-not-found');
  }
}
