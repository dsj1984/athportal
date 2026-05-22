// apps/api/src/routes/v1/admin/reports.ts
//
// Org-scoped admin report endpoints (Epic #10 / Story #679 / Task #698).
//
// Currently hosts one route:
//
//   GET /verified-achievements   — aggregation counts by team and by
//                                  sport for the actor's org.
//
// The router is mounted under `/api/v1/admin/reports` by `./index.ts`,
// which already runs `requireRole('org_admin')` for the entire admin
// tree — so every handler in this file can assume
// `c.var.auth.role === 'org_admin'` or `dev_admin` (the platform-root
// short-circuit).
//
// Per `.agents/rules/security-baseline.md` (Input Validation,
// Authorization, Output & Rendering):
//
//   - No query inputs on this Story — the actor's org is derived from
//     `c.var.auth.orgId`. A future Story that adds filters MUST add
//     a strict Zod schema at the edge.
//   - Every read is org-scoped against `c.var.auth.orgId` — an
//     org_admin in org A cannot enumerate org B's report. Defense in
//     depth: pin both sides of the join to the same org.
//   - Responses carry the canonical envelope
//     `{ success: true, data: { byTeam, bySport } }` or
//     `{ success: false, error: { code, message } }` with no stack
//     traces.
//
// ⚠️ Achievements table — pending v1.0 Epic.
//
// There is **no `verified_achievements` table on epic/10 yet** — see
// Story #661's roster endpoint, which pinned
// `verifiedAchievementCount: 0` for every athlete with that exact
// rationale (`apps/api/src/routes/v1/admin/roster.ts`, the
// `verifiedAchievementCount` projection). This report follows the same
// pattern: we aggregate **the row set** against the real tables
// (`teams`, `athlete_memberships`) so each team and each sport in the
// actor's org surfaces once in the response, but the count is
// hard-zero on every row. The wire shape and the alphabetical ordering
// are pinned by the contract test
// (`./reports.contract.test.ts`) so the v1.0 achievements Epic can
// swap the count source in without breaking the page.
//
// Tier: contract. The cross-org isolation and ordering invariants
// live in `./reports.contract.test.ts` alongside this file.

import { athleteMemberships, teams } from '@repo/shared/db/schema';
import {
  VerifiedAchievementBySportSchema,
  VerifiedAchievementByTeamSchema,
  VerifiedAchievementReportSchema,
} from '@repo/shared/schemas/admin/reports';
import { type SQL, and, eq, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import type { RequireInternalUserEnv } from '../../../middleware/auth';

// ── Error taxonomy ─────────────────────────────────────────────────────────

type ReportErrorCode = 'MISSING_ORG_SCOPE';

interface ReportErrorBody {
  readonly success: false;
  readonly error: {
    readonly code: ReportErrorCode;
    readonly message: string;
  };
}

function errorBody(code: ReportErrorCode, message: string): ReportErrorBody {
  return { success: false, error: { code, message } };
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Resolve the org-scope to use for this request. An `org_admin` is
 * pinned to its own org by `c.var.auth.orgId`; a `dev_admin` may target
 * any org via `?orgId=…`, falling back to its own org when omitted.
 * Returns `null` when the scope cannot be resolved (the handler then
 * short-circuits with `MISSING_ORG_SCOPE`). Mirrors the resolver in
 * `./roster.ts`.
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

interface AggregationJoinedRow {
  membershipId: string;
  teamId: string;
  teamName: string;
  sport: string;
}

/**
 * Structural shape of the Drizzle handle this router uses. Mirrors the
 * `RosterDb` pattern in `./roster.ts`: the concrete handle is supplied
 * at test time by an ephemeral SQLite handle and at runtime by the
 * Worker entrypoint. The chain is typed transparently.
 */
interface ReportSelectChain {
  from: (table: typeof athleteMemberships) => {
    innerJoin: (
      joined: typeof teams,
      predicate: SQL,
    ) => {
      where: (predicate: SQL) => Promise<AggregationJoinedRow[]>;
    };
  };
}

interface ReportDb {
  select: (projection: Record<string, unknown>) => ReportSelectChain;
}

// ── Router ─────────────────────────────────────────────────────────────────

export const reportsAdminRoute = new Hono<RequireInternalUserEnv>();

/**
 * GET /api/v1/admin/reports/verified-achievements
 *
 * Returns the canonical envelope
 *   { success: true, data: { byTeam: [...], bySport: [...] } }
 *
 * `byTeam` carries one row per team in the actor's org that currently
 * has at least one active membership; `bySport` carries one row per
 * distinct `teams.sport` value across those teams. Both arrays are
 * sorted alphabetically (case-insensitive) by their label for
 * deterministic rendering.
 *
 * Active memberships only: rows with a non-null `ended_at` are
 * excluded from the aggregation (these are end-dated audit rows that
 * should not contribute to a "current" report). Empty orgs return
 * `{ byTeam: [], bySport: [] }` — never `null`.
 *
 * `verifiedAchievementCount` is pinned to `0` on every row — see the
 * file header for the rationale and the v1.0 swap path.
 */
reportsAdminRoute.get('/verified-achievements', async (c) => {
  const orgId = resolveOrgScope(c);
  if (!orgId) {
    return c.json(errorBody('MISSING_ORG_SCOPE', 'Actor has no orgId in scope.'), 400);
  }

  const db = c.get('db') as ReportDb;

  // Defense in depth — pin both the membership and team rows to the
  // actor's org. A future schema change that breaks the cross-tenant
  // CHECK trigger still cannot leak a row through this surface.
  const predicates: SQL[] = [
    eq(athleteMemberships.orgId, orgId),
    eq(teams.orgId, orgId),
    isNull(athleteMemberships.endedAt),
  ];

  const combined = and(...predicates);
  if (!combined) {
    // Unreachable — the predicates array is non-empty above. The guard
    // satisfies drizzle's `SQL | undefined` return type without an `as`
    // cast.
    return c.json(errorBody('MISSING_ORG_SCOPE', 'Internal predicate composition failed.'), 400);
  }

  // The join projects every active (membership, team) pair in the org.
  // The aggregation is done in JS — Story #661 took the same approach
  // (it iterates roster pages without a SQL aggregate), and the row
  // counts at this surface are bounded by the org's active-membership
  // count, which is small.
  const rows = await db
    .select({
      membershipId: athleteMemberships.id,
      teamId: teams.id,
      teamName: teams.name,
      sport: teams.sport,
    })
    .from(athleteMemberships)
    .innerJoin(teams, eq(teams.id, athleteMemberships.teamId))
    .where(combined);

  // Aggregate: distinct teams (by id) and distinct sports.
  const byTeamMap = new Map<string, { teamId: string; teamName: string }>();
  const bySportSet = new Set<string>();
  for (const r of rows) {
    if (!byTeamMap.has(r.teamId)) {
      byTeamMap.set(r.teamId, { teamId: r.teamId, teamName: r.teamName });
    }
    bySportSet.add(r.sport);
  }

  // No achievements table yet (out of scope for this Epic). The
  // contract reserves the count column so the page can render it
  // without a future wire-shape break when achievements ship —
  // mirrors `verifiedAchievementCount: 0` in `./roster.ts`.
  const byTeam = Array.from(byTeamMap.values())
    .map(({ teamId, teamName }) =>
      VerifiedAchievementByTeamSchema.parse({
        teamId,
        teamName,
        verifiedAchievementCount: 0,
      }),
    )
    .sort((a, b) => a.teamName.localeCompare(b.teamName, 'en', { sensitivity: 'base' }));

  const bySport = Array.from(bySportSet.values())
    .map((sport) =>
      VerifiedAchievementBySportSchema.parse({
        sport,
        verifiedAchievementCount: 0,
      }),
    )
    .sort((a, b) => a.sport.localeCompare(b.sport, 'en', { sensitivity: 'base' }));

  const report = VerifiedAchievementReportSchema.parse({ byTeam, bySport });
  return c.json({ success: true, data: report }, 200);
});
