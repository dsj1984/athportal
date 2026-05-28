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
// Endpoints:
//
//   GET    /                              — list active roster entries
//                                           for the team (Story #912)
//   GET    /entries/:entryId              — one team-scoped roster
//                                           entry (Story #912)
//   PATCH  /entries/:entryId              — edit jersey + position with
//                                           soft duplicate-jersey warning
//                                           (Story #917 / Task #924)
//   DELETE /entries/:entryId              — soft-delete via ended_at,
//                                           idempotent (Story #917 / Task #924)
//
// Tier: contract. Cross-tenant isolation and the requireCoachOnTeam
// gate are pinned in `./roster.contract.test.ts` (read surface) and
// `./roster-entries.contract.test.ts` (mutation surface).

import {
  type RosterEntryRow,
  endRosterEntry,
  getTeamScopedAthlete,
  jerseyNumberInUse,
  listRosterEntries,
  updateRosterEntry,
} from '@repo/shared/db/queries/coach/roster';
import type { AuthContext as RbacAuthContext, Role } from '@repo/shared/rbac';
import { HttpError, requireCoachOnTeam } from '@repo/shared/rbac/coachOnTeam';
import { EditRosterEntryInput, RosterEntryOutput } from '@repo/shared/schemas/coach/roster';
import { Hono } from 'hono';
import type {
  AuthContext as ApiAuthContext,
  RequireInternalUserEnv,
} from '../../../middleware/auth';

// ── Error taxonomy ─────────────────────────────────────────────────────────

type CoachRosterErrorCode = 'NOT_FOUND' | 'MISSING_ORG_SCOPE' | 'INVALID_INPUT';

interface CoachRosterErrorBody {
  readonly success: false;
  readonly error: {
    readonly code: CoachRosterErrorCode;
    readonly message: string;
    readonly field?: string;
  };
}

function errorBody(
  code: CoachRosterErrorCode,
  message: string,
  field?: string,
): CoachRosterErrorBody {
  return {
    success: false,
    error: field !== undefined ? { code, message, field } : { code, message },
  };
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
    await requireCoachOnTeam(
      toRbacActor(auth),
      teamId,
      db as Parameters<typeof requireCoachOnTeam>[2],
    );
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
    await requireCoachOnTeam(
      toRbacActor(auth),
      teamId,
      db as Parameters<typeof requireCoachOnTeam>[2],
    );
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

/**
 * PATCH /api/v1/coach/teams/:teamId/roster/entries/:entryId
 *
 * Edit `jerseyNumber` and/or `primaryPosition` on one team-scoped
 * roster entry. Both fields are independently optional; at least one
 * must be supplied (enforced by `EditRosterEntryInput.refine`).
 *
 * Soft-warning surface: when the new `jerseyNumber` collides with
 * another active entry on the same team, the response carries
 * `data.warnings.duplicateJerseyNumber = true`. No DB-level unique
 * constraint enforces uniqueness (Tech Spec #906 §UX Behaviors); the
 * coach decides whether to fix it.
 *
 * Responses:
 *   200 — { success: true, data: { entry, warnings? } }
 *   400 — { success: false, error: { code: 'INVALID_INPUT', ... } }
 *   401 — clerkAuth refused upstream
 *   404 — actor does not coach this team, or entry not found on the
 *         URL-bound team for this org (the predicate refuses without
 *         confirming which of those is true)
 */
coachRosterRoute.patch('/entries/:entryId', async (c) => {
  const auth = c.get('auth');
  const teamId = c.req.param('teamId');
  const entryId = c.req.param('entryId');

  if (!auth.orgId) {
    return c.json(errorBody('MISSING_ORG_SCOPE', 'Actor has no orgId in scope.'), 400);
  }
  if (!teamId || !entryId) {
    return c.json(errorBody('NOT_FOUND', 'entry-not-found'), 404);
  }

  // Parse the body BEFORE the auth check so a malformed payload returns
  // 400 deterministically. The auth predicate runs inside the same
  // handler so an attacker probing this surface still cannot tell the
  // difference between "team not yours" and "team doesn't exist".
  //
  // Story #989 — emit a single user-facing `error.message` drawn from
  // `issues[0]?.message` (mirroring the coach-invites POST shape) plus
  // an optional `error.field` that names the failing input. Surfacing
  // the raw Zod issue array via `err.message` is hostile to consumers:
  // every caller had to JSON.parse the message and pick the first issue
  // themselves before they could render anything human-readable.
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json(errorBody('INVALID_INPUT', 'Invalid input.'), 400);
  }
  const safe = EditRosterEntryInput.safeParse(raw);
  if (!safe.success) {
    const firstIssue = safe.error.issues[0];
    const message = firstIssue?.message ?? 'Invalid input.';
    const field = firstIssue?.path[0];
    return c.json(
      errorBody('INVALID_INPUT', message, typeof field === 'string' ? field : undefined),
      400,
    );
  }
  const parsed = safe.data;

  const db = c.get('db');

  try {
    await requireCoachOnTeam(
      toRbacActor(auth),
      teamId,
      db as Parameters<typeof requireCoachOnTeam>[2],
    );
  } catch (err) {
    if (err instanceof HttpError) {
      return c.json(errorBody('NOT_FOUND', err.message), 404);
    }
    throw err;
  }

  const updated = updateRosterEntry(db, { orgId: auth.orgId }, teamId, entryId, parsed);
  if (!updated) {
    return c.json(errorBody('NOT_FOUND', 'entry-not-found'), 404);
  }

  // Probe for a soft-warning duplicate-jersey-number collision. Only
  // surfaces when the caller actually wrote a non-null jersey value
  // (clearing it can never collide).
  let duplicateJerseyNumber = false;
  if (parsed.jerseyNumber !== undefined && parsed.jerseyNumber !== null) {
    duplicateJerseyNumber = jerseyNumberInUse(
      db,
      { orgId: auth.orgId },
      teamId,
      parsed.jerseyNumber,
      entryId,
    );
  }

  const body = {
    success: true as const,
    data: {
      entry: projectEntry(updated),
      ...(duplicateJerseyNumber ? { warnings: { duplicateJerseyNumber: true } } : {}),
    },
  };
  return c.json(body, 200);
});

/**
 * DELETE /api/v1/coach/teams/:teamId/roster/entries/:entryId
 *
 * Soft-delete one roster entry by setting `ended_at = now()`. The
 * audit row stays in place; subsequent reads (via `listRosterEntries`
 * or `getTeamScopedAthlete`) filter it out.
 *
 * Idempotent: re-running on an already-ended row succeeds with 204
 * the same as the first call. The same row id can be re-used on a
 * future invitation (the partial unique index on `(team_id,
 * athlete_user_id) WHERE ended_at IS NULL` allows reuse).
 *
 * Responses:
 *   204 — entry was removed (or already removed)
 *   401 — clerkAuth refused upstream
 *   404 — actor does not coach this team
 */
coachRosterRoute.delete('/entries/:entryId', async (c) => {
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
    await requireCoachOnTeam(
      toRbacActor(auth),
      teamId,
      db as Parameters<typeof requireCoachOnTeam>[2],
    );
  } catch (err) {
    if (err instanceof HttpError) {
      return c.json(errorBody('NOT_FOUND', err.message), 404);
    }
    throw err;
  }

  // The mutation refuses to touch already-ended rows; the boolean
  // return is informational. We respond 204 in both cases so DELETE
  // is idempotent from the client's perspective.
  endRosterEntry(db, { orgId: auth.orgId }, teamId, entryId);
  return c.body(null, 204);
});
