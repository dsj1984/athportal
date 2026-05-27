// apps/api/src/routes/v1/admin/roster.ts
//
// Org-wide athlete roster read endpoint (Epic #10 / Story #661 /
// Task #692).
//
// Replaces the Story #654 placeholder. The router is mounted under
// `/api/v1/admin/roster` by `./index.ts`, which already runs
// `requireRole('org_admin')` for the entire admin tree — so every
// handler in this file can assume `c.var.auth.role === 'org_admin'`
// or `dev_admin` (the platform-root short-circuit).
//
// Per `.agents/rules/security-baseline.md` (Input Validation,
// Authorization, Output & Rendering):
//
//   - The query string is validated at the edge with
//     `RosterQuerySchema` from `@repo/shared/schemas/admin/roster`.
//     Unknown keys are a hard 400 INVALID_QUERY (the schema uses
//     `.strict()`).
//   - Every read is org-scoped against `c.var.auth.orgId` — an
//     org_admin in org A cannot enumerate org B's roster. The
//     handler joins `athlete_memberships ⋈ users ⋈ teams` and pins
//     `athlete_memberships.org_id = actor.orgId` in the WHERE clause.
//   - The `dev_admin` (platform-root) role admits to the admin tree
//     via the gate's short-circuit, but is required to supply an
//     orgId via `?orgId=` (re-using the same pattern as the teams
//     CRUD router). Without an orgId scope, `dev_admin` still cannot
//     enumerate every tenant's roster from this surface — by design.
//   - Responses carry the canonical envelope
//     `{ success: true, data: { items, nextCursor } }` or
//     `{ success: false, error: { code, message } }` with no stack
//     traces or internal class names.
//
// Endpoint:
//
//   GET    /                        — paginated org-wide roster
//                                     with optional `?teamId=` and
//                                     `?sport=` filters
//
// Tier: contract. The cross-org isolation and pagination invariants
// live in `./roster.contract.test.ts` alongside this file.

import { athleteMemberships, teams, users } from '@repo/shared/db/schema';
import {
  RosterItemSchema,
  RosterPageSchema,
  RosterQuerySchema,
} from '@repo/shared/schemas/admin/roster';
import { type SQL, and, asc, eq, gt, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import type { RequireInternalUserEnv } from '../../../middleware/auth';

// ── Error taxonomy ─────────────────────────────────────────────────────────

type RosterErrorCode = 'INVALID_QUERY' | 'MISSING_ORG_SCOPE';

interface RosterErrorBody {
  readonly success: false;
  readonly error: {
    readonly code: RosterErrorCode;
    readonly message: string;
  };
}

function errorBody(code: RosterErrorCode, message: string): RosterErrorBody {
  return { success: false, error: { code, message } };
}

// ── Helpers ────────────────────────────────────────────────────────────────

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * Derive a user-visible name from the user's email when no name column
 * exists yet on `users`. Splits the local-part on common separators
 * and title-cases each token; falls back to the raw email when the
 * shape is degenerate (no `@`, empty local-part, etc.).
 *
 * This is a placeholder projection — a future Epic that adds a real
 * `full_name` column on `users` will swap this for the column read
 * without changing the wire shape (the schema already pins
 * `fullName: z.string()`).
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
 * Resolve the org-scope to use for this request. An `org_admin` is
 * pinned to its own org by `c.var.auth.orgId`; a `dev_admin` may target
 * any org via `?orgId=…`. Returns `null` when the scope cannot be
 * resolved (the handler then short-circuits with `MISSING_ORG_SCOPE`).
 */
function resolveOrgScope(c: {
  get: (k: 'auth') => { role: string; orgId: string | null };
  req: { query: (name: string) => string | undefined };
}): string | null {
  const auth = c.get('auth');
  if (auth.role === 'dev_admin') {
    const target = c.req.query('orgId');
    if (target && target.length > 0) return target;
    return auth.orgId ?? null;
  }
  return auth.orgId;
}

interface RosterJoinedRow {
  membershipId: string;
  athleteUserId: string;
  email: string;
  teamId: string;
  teamName: string;
  sport: string;
  ageGroup: string;
}

/**
 * Structural shape of the Drizzle handle this router uses. Mirrors the
 * `TeamsDb` pattern in `./teams.ts`: the concrete handle is supplied at
 * test time by an ephemeral SQLite handle and at runtime by the Worker
 * entrypoint. The chain is typed transparently — `select(projection)`
 * returns the builder we forward verbatim; only the projection columns
 * are pinned by `RosterJoinedRow`.
 */
interface RosterSelectChain {
  from: (table: typeof athleteMemberships) => {
    innerJoin: (
      joined: typeof users | typeof teams,
      predicate: SQL,
    ) => {
      innerJoin: (
        joined: typeof users | typeof teams,
        predicate: SQL,
      ) => {
        where: (predicate: SQL) => {
          orderBy: (...cols: SQL[]) => {
            limit: (n: number) => Promise<RosterJoinedRow[]>;
          };
        };
      };
    };
  };
}

interface RosterDb {
  select: (projection: Record<string, unknown>) => RosterSelectChain;
}

// ── Router ─────────────────────────────────────────────────────────────────

export const rosterAdminRoute = new Hono<RequireInternalUserEnv>();

/**
 * GET /api/v1/admin/roster
 *
 *   ?teamId=…   narrow to one team
 *   ?sport=…    narrow to one sport (matches teams.sport)
 *   ?cursor=…   opaque server-issued cursor; pass back the
 *               `nextCursor` from the previous page to advance
 *   ?limit=…    page size (default 50, max 200)
 *
 * Returns the canonical envelope
 *   { success: true, data: { items, nextCursor } }
 *
 * `nextCursor` is `null` when the page is the last one. The cursor is
 * the `athlete_memberships.id` of the last row in the current page —
 * ordering on the membership PK gives us a stable, monotonic key for
 * keyset pagination that survives concurrent writes.
 *
 * Active memberships only: rows with a non-null `ended_at` are excluded
 * (these are end-dated audit rows that should not appear on a "current
 * roster" view).
 */
rosterAdminRoute.get('/', async (c) => {
  const orgId = resolveOrgScope(c);
  if (!orgId) {
    return c.json(errorBody('MISSING_ORG_SCOPE', 'Actor has no orgId in scope.'), 400);
  }

  // Pass the full query record to the schema so `.strict()` can reject
  // unknown keys. The `orgId` dev-admin escape hatch is handled by
  // `resolveOrgScope` above and is stripped here before validation —
  // it is NOT part of the public query contract for org_admin callers,
  // so the schema must not see it.
  const { orgId: _orgIdEscape, ...rawQuery } = c.req.query();
  void _orgIdEscape;

  const parsed = RosterQuerySchema.safeParse(rawQuery);
  if (!parsed.success) {
    return c.json(
      errorBody('INVALID_QUERY', parsed.error.issues[0]?.message ?? 'Invalid query.'),
      400,
    );
  }
  const q = parsed.data;
  const pageSize = Math.min(q.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

  const db = c.get('db') as RosterDb;

  // Build the predicate. The org-scope predicate is load-bearing — it
  // is the only thing keeping org A's roster out of org B's response.
  // Defense in depth: pin the joined rows to the same org on all three
  // sides of the join so a future schema change that breaks the
  // athlete-memberships cross-tenant CHECK trigger still cannot leak
  // a row through this surface.
  const predicates: SQL[] = [
    eq(athleteMemberships.orgId, orgId),
    eq(teams.orgId, orgId),
    eq(users.orgId, orgId),
    isNull(athleteMemberships.endedAt),
  ];
  if (q.teamId) predicates.push(eq(athleteMemberships.teamId, q.teamId));
  if (q.sport) predicates.push(eq(teams.sport, q.sport));
  if (q.cursor) predicates.push(gt(athleteMemberships.id, q.cursor));

  const combined = and(...predicates);
  if (!combined) {
    // Unreachable — the predicates array is non-empty above. The guard
    // is here to satisfy drizzle's `SQL | undefined` return type
    // without an `as` cast.
    return c.json(errorBody('INVALID_QUERY', 'Internal predicate composition failed.'), 400);
  }

  // Fetch pageSize + 1 so we can detect whether a next page exists
  // without a separate count query.
  const rows = await db
    .select({
      membershipId: athleteMemberships.id,
      athleteUserId: athleteMemberships.athleteUserId,
      email: users.email,
      teamId: teams.id,
      teamName: teams.name,
      sport: teams.sport,
      ageGroup: teams.ageGroup,
    })
    .from(athleteMemberships)
    .innerJoin(users, eq(users.id, athleteMemberships.athleteUserId))
    .innerJoin(teams, eq(teams.id, athleteMemberships.teamId))
    .where(combined)
    .orderBy(asc(athleteMemberships.id))
    .limit(pageSize + 1);

  const hasMore = rows.length > pageSize;
  const pageRows = hasMore ? rows.slice(0, pageSize) : rows;
  const lastRow = pageRows[pageRows.length - 1];
  const nextCursor = hasMore && lastRow ? lastRow.membershipId : null;

  const items = pageRows.map((r) =>
    RosterItemSchema.parse({
      // Surfaced by Story #972 — the season-rollover decisions table
      // keys on `membershipId`; without it the form had to synthesize
      // a key (which the rollover planner then rejected as
      // UNKNOWN_MEMBERSHIP, silently breaking the entire surface).
      membershipId: r.membershipId,
      athleteId: r.athleteUserId,
      fullName: deriveFullName(r.email),
      teamId: r.teamId,
      teamName: r.teamName,
      sport: r.sport,
      ageGroup: r.ageGroup,
      // No achievements table yet (out of scope for this Epic). The
      // contract reserves the column so the page can render it without
      // a future wire-shape break when achievements ship.
      verifiedAchievementCount: 0,
    }),
  );

  const page = RosterPageSchema.parse({ items, nextCursor });
  return c.json({ success: true, data: page }, 200);
});
