// apps/api/src/routes/v1/coach/roster.ts
//
// Coach-scoped roster read endpoint (Epic #11 / Story #912 / Task #919).
//
// Mounted under `/api/v1/coach/teams/:teamId/roster` by `./index.ts`,
// which itself mounts onto the `clerkAuth → withDb →
// requireInternalUser → requireOnboarded` chain.
//
// Per `.agents/rules/security-baseline.md` (Authorization, Input
// Validation, Output & Rendering):
//
//   - Every request is gated by `requireCoachOnTeam(actor, teamId)`
//     BEFORE any query runs. The predicate throws `HttpError(404,
//     'team-not-found')` for every "no" case — actor doesn't coach the
//     team, team doesn't exist, assignment is ended. Returning a 404
//     instead of a 403 refuses to confirm the team's existence to an
//     attacker probing org B from inside org A.
//   - The query layer (`@repo/shared/db/queries/coach/roster`) pins
//     `org_id = actor.orgId` on every read as defense-in-depth — even
//     if a future bug let the route handler skip the predicate, the
//     org-scope predicate inside the query would still keep
//     cross-tenant rows out.
//   - Output is the canonical envelope `{ success, data | error }`.
//     The wire shape is pinned by `RosterEntryOutput` from
//     `@repo/shared/schemas/coach/roster` — internal columns (org_id,
//     audit timestamps) ride the projection but the schema strips
//     anything not nominated for the public surface.
//
// Endpoints (this Story):
//
//   GET /                                — list active roster entries
//                                          for the team
//   GET /entries/:entryId                — one team-scoped roster
//                                          entry (Task #922)
//
// Tier: contract. Cross-tenant isolation and the requireCoachOnTeam
// gate are pinned in `./roster.contract.test.ts`.

import {
  type RosterEntryRow,
  getTeamScopedAthlete,
  listRosterEntries,
} from '@repo/shared/db/queries/coach/roster';
import { HttpError, requireCoachOnTeam } from '@repo/shared/rbac/coachOnTeam';
import type { AuthContext as RbacAuthContext, Role } from '@repo/shared/rbac';
import { RosterEntryOutput } from '@repo/shared/schemas/coach/roster';
import { Hono } from 'hono';
import type { AuthContext as ApiAuthContext, RequireInternalUserEnv } from '../../../middleware/auth';

// ── Error taxonomy ─────────────────────────────────────────────────────────

type CoachRosterErrorCode = 'NOT_FOUND' | 'MISSING_ORG_SCOPE';

interface CoachRosterErrorBody {
  readonly success: false;
  readonly error: {
    readonly code: CoachRosterErrorCode;
    readonly message: string;
  };
}

function errorBody(code: CoachRosterErrorCode, message: string): CoachRosterErrorBody {
  return { success: false, error: { code, message } };
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Derive a user-visible name from the user's email until a real
 * `full_name` column lands on `users`. Mirrors the helper in
 * `apps/api/src/routes/v1/admin/roster.ts` so the wire shape stays
 * consistent between the org-wide admin view and the team-scoped
 * coach view.
 */
function deriveFullName(email: string): string {
  const at = email.indexOf('@');
  const local = at > 0 ? email.slice(0, at) : email;
  if (local.length === 0) return email;
  const tokens = local
    .split(/[._-]+/)
    .filter((t) => t.length > 0)
    .map((t) => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase());
  return tokens.length > 0 ? tokens.join(' ') : email;
}

/**
 * Adapt the API-side `AuthContext` (string-typed role, nullable orgId)
 * to the shape `requireCoachOnTeam` consumes (rbac `AuthContext` with
 * the `Role` union and optional orgId). The predicate only reads
 * `actor.userId`, so the role narrowing is structurally safe — but we
 * preserve the role value through a `Role` cast so future predicates
 * that DO read role do not need to re-derive the same shim.
 */
function toRbacActor(auth: ApiAuthContext): RbacAuthContext {
  const orgId = auth.orgId ?? undefined;
  const teamId = auth.teamId ?? undefined;
  const role = auth.role as Role;
  return orgId !== undefined
    ? teamId !== undefined
      ? { userId: auth.userId, clerkSubjectId: auth.clerkSubjectId, role, orgId, teamId }
      : { userId: auth.userId, clerkSubjectId: auth.clerkSubjectId, role, orgId }
    : { userId: auth.userId, clerkSubjectId: auth.clerkSubjectId, role };
}

/**
 * Project an internal `RosterEntryRow` to the public `RosterEntryOutput`
 * shape. Dates serialize to ISO strings so the wire shape is JSON-safe.
 */
function projectEntry(row: RosterEntryRow): unknown {
  return RosterEntryOutput.parse({
    id: row.id,
    teamId: row.teamId,
    athleteUserId: row.athleteUserId,
    athleteEmail: row.athleteEmail,
    athleteFullName: deriveFullName(row.athleteEmail),
    jerseyNumber: row.jerseyNumber,
    primaryPosition: row.primaryPosition,
    endedAt: row.endedAt ? row.endedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

// ── Router ─────────────────────────────────────────────────────────────────

export const coachRosterRoute = new Hono<RequireInternalUserEnv>();

/**
 * GET /api/v1/coach/teams/:teamId/roster
 *
 * Returns the active roster entries for the team, in creation order
 * (oldest first — matches the order athletes joined the team).
 *
 * Responses:
 *   200 — { success: true, data: { items: RosterEntryOutput[] } }
 *   401 — clerkAuth refused upstream (no active session)
 *   404 — actor does not coach this team (or the team does not exist)
 */
coachRosterRoute.get('/', async (c) => {
  const auth = c.get('auth');
  const teamId = c.req.param('teamId');

  if (!auth.orgId) {
    // `requireInternalUser` guarantees an `auth.orgId` for every
    // non-dev_admin actor on the protected tree, but `dev_admin` may
    // legitimately reach this surface without an org scope. We refuse
    // that case explicitly — coach roster reads are tenant-scoped by
    // construction.
    return c.json(errorBody('MISSING_ORG_SCOPE', 'Actor has no orgId in scope.'), 400);
  }
  if (!teamId) {
    // Defense-in-depth: the route is mounted under `/teams/:teamId/`
    // so this is unreachable in practice. Hono would have refused the
    // request at the router level. Still — fail closed rather than
    // pass `undefined` into the predicate.
    return c.json(errorBody('NOT_FOUND', 'team-not-found'), 404);
  }

  const db = c.get('db');

  try {
    // `c.var.db` is structurally `unknown` (per `InternalUserDb`). The
    // `requireCoachOnTeam` predicate narrows it via its own structural
    // type (`CoachOnTeamDb`); cast through `unknown` to satisfy that
    // boundary without leaking the assertion into the shared module.
    await requireCoachOnTeam(toRbacActor(auth), teamId, db as Parameters<typeof requireCoachOnTeam>[2]);
  } catch (err) {
    if (err instanceof HttpError) {
      return c.json(errorBody('NOT_FOUND', err.message), 404);
    }
    throw err;
  }

  const rows = listRosterEntries(db, { orgId: auth.orgId }, teamId);
  const items = rows.map(projectEntry);
  return c.json({ success: true, data: { items } }, 200);
});

/**
 * GET /api/v1/coach/teams/:teamId/roster/entries/:entryId
 *
 * Returns one team-scoped roster entry. The lookup is scoped to the
 * URL-bound team, so an athlete on multiple teams resolves to the row
 * whose `team_id` matches — the page renders THIS team's jersey and
 * position, never another team's.
 *
 * Responses mirror the list endpoint, with an additional 404 path for
 * "entry not on this team in this org".
 */
coachRosterRoute.get('/entries/:entryId', async (c) => {
  const auth = c.get('auth');
  const teamId = c.req.param('teamId');
  const entryId = c.req.param('entryId');

  if (!auth.orgId) {
    return c.json(errorBody('MISSING_ORG_SCOPE', 'Actor has no orgId in scope.'), 400);
  }
  if (!teamId || !entryId) {
    return c.json(errorBody('NOT_FOUND', 'entry-not-found'), 404);
  }

  const db = c.get('db');

  try {
    await requireCoachOnTeam(toRbacActor(auth), teamId, db as Parameters<typeof requireCoachOnTeam>[2]);
  } catch (err) {
    if (err instanceof HttpError) {
      return c.json(errorBody('NOT_FOUND', err.message), 404);
    }
    throw err;
  }

  const row = getTeamScopedAthlete(db, { orgId: auth.orgId }, teamId, entryId);
  if (!row) {
    return c.json(errorBody('NOT_FOUND', 'entry-not-found'), 404);
  }
  return c.json({ success: true, data: projectEntry(row) }, 200);
});
