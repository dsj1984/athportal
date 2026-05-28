/**
 * @repo/shared/db/queries/userTeams — "teams this user belongs to" reader.
 *
 * Story #985 / F27. Backs the dashboard "Roster" widget, which must
 * surface every team a signed-in user belongs to — whether they coach
 * it (`coach_assignments`) or are rostered on it as an athlete
 * (`athlete_memberships`). Before this reader the widget read no data
 * at all and always rendered the "No teams yet" empty state, so a
 * coach-only user had no discoverable path from `/dashboard` to their
 * roster.
 *
 * The web runtime's SSR only sees the Clerk `sub` claim, so the public
 * accessor keys on `clerk_subject_id` and resolves the internal
 * `users.id` itself (mirroring `getOnboardingStateBySubject`).
 *
 * Active-only: coach/athlete rows with `ended_at IS NULL` and teams
 * that are neither soft-deleted (`deleted_at`) nor archived
 * (`archived_at`). End-dated/archived rows stay as audit history but
 * never appear on the dashboard.
 *
 * Pure relative to the `db` argument — two reads, no mutation, no HTTP
 * imports.
 */

import { type SQL, and, asc, eq, isNull } from 'drizzle-orm';
import { athleteMemberships } from '../schema/athleteMemberships';
import { coachAssignments } from '../schema/coachAssignments';
import { teams } from '../schema/teams';
import { users } from '../schema/users';

/** The role through which a user belongs to a team. */
export type UserTeamRole = 'coach' | 'athlete';

/** One team a user belongs to, with the role that grants the membership. */
export interface UserTeamRow {
  readonly teamId: string;
  readonly teamName: string;
  readonly role: UserTeamRole;
}

interface TeamNameRow {
  readonly teamId: string;
  readonly teamName: string;
}

interface UserIdRow {
  readonly id: string;
}

/** Structural shape of the single-table user-id lookup. */
interface ResolveUserChain {
  select: (projection: { id: typeof users.id }) => {
    from: (table: typeof users) => {
      where: (predicate: SQL) => {
        limit: (n: number) => { all: () => UserIdRow[] };
      };
    };
  };
}

/**
 * Structural shape of the join chain both reads exercise. Typed
 * transparently — the contract test supplies a real better-sqlite3
 * Drizzle handle and the unit test supplies a fresh schema handle;
 * both satisfy this shape.
 */
interface TeamJoinChain {
  from: (table: typeof coachAssignments | typeof athleteMemberships) => {
    innerJoin: (
      joined: typeof teams,
      predicate: SQL,
    ) => {
      where: (predicate: SQL) => {
        orderBy: (...cols: SQL[]) => { all: () => TeamNameRow[] };
      };
    };
  };
}

interface UserTeamsDbHandle extends ResolveUserChain {
  select: ((projection: { id: typeof users.id }) => ReturnType<ResolveUserChain['select']>) &
    ((projection: Record<string, unknown>) => TeamJoinChain);
}

function combine(parts: SQL[]): SQL {
  const combined = and(...parts);
  if (!combined) {
    throw new Error('userTeams: failed to combine WHERE predicates');
  }
  return combined;
}

/**
 * Resolve the internal `users.id` for a Clerk subject. Returns `null`
 * when no row exists (the JIT-provisioner hasn't run, or the row was
 * deleted out-of-band) — the caller renders the empty state.
 */
function resolveUserIdBySubject(handle: UserTeamsDbHandle, clerkSubjectId: string): string | null {
  const rows = handle
    .select({ id: users.id })
    .from(users)
    .where(eq(users.clerkSubjectId, clerkSubjectId))
    .limit(1)
    .all();
  return rows[0]?.id ?? null;
}

/**
 * Return every active team the user (identified by Clerk subject)
 * belongs to, coach teams first then athlete teams, each block ordered
 * by team name. A user who both coaches and plays on the same team
 * appears once per role.
 *
 * Returns an empty array when the subject resolves to no internal user
 * or the user belongs to no active, non-archived team.
 */
export function listUserTeamsBySubject(db: unknown, clerkSubjectId: string): UserTeamRow[] {
  const handle = db as UserTeamsDbHandle;
  const userId = resolveUserIdBySubject(handle, clerkSubjectId);
  if (userId === null) return [];

  const coachRows = handle
    .select({ teamId: teams.id, teamName: teams.name })
    .from(coachAssignments)
    .innerJoin(teams, eq(teams.id, coachAssignments.teamId))
    .where(
      combine([
        eq(coachAssignments.coachUserId, userId),
        isNull(coachAssignments.endedAt),
        isNull(teams.deletedAt),
        isNull(teams.archivedAt),
      ]),
    )
    .orderBy(asc(teams.name))
    .all();

  const athleteRows = handle
    .select({ teamId: teams.id, teamName: teams.name })
    .from(athleteMemberships)
    .innerJoin(teams, eq(teams.id, athleteMemberships.teamId))
    .where(
      combine([
        eq(athleteMemberships.athleteUserId, userId),
        isNull(athleteMemberships.endedAt),
        isNull(teams.deletedAt),
        isNull(teams.archivedAt),
      ]),
    )
    .orderBy(asc(teams.name))
    .all();

  return [
    ...coachRows.map((r) => ({ teamId: r.teamId, teamName: r.teamName, role: 'coach' as const })),
    ...athleteRows.map((r) => ({
      teamId: r.teamId,
      teamName: r.teamName,
      role: 'athlete' as const,
    })),
  ];
}
