// apps/api/src/routes/v1/admin/rollover.ts
//
// Season-rollover preview + commit endpoints (Epic #10 / Story #665 /
// Task #695). Replaces the Story #654 placeholder.
//
// The router is mounted under `/api/v1/admin/rollover` by `./index.ts`,
// which already runs `requireRole('org_admin')` for the entire admin
// tree — so every handler here can assume
// `c.var.auth.role === 'org_admin'` or `dev_admin`.
//
// Two endpoints, sharing one pure plan builder:
//
//   POST /preview — compute the plan for the supplied per-membership
//                   choices. No DB write. The response is the canonical
//                   `RolloverPlan` shape from `@repo/shared/rollover`.
//   POST /commit  — apply the plan inside a single transaction. The
//                   handler re-runs `buildPlan` server-side against the
//                   CURRENT DB state and compares the recomputed plan
//                   against the `expectedPlan` the client carried back
//                   from preview. If they differ (a membership moved
//                   between preview and commit) the response is
//                   409 STALE_PLAN and no writes happen.
//
// The STALE_PLAN invariant (AC-9) is the load-bearing safety property
// of this surface. It guards against the classic
// "preview-against-stale-data" race: a second admin reassigns an
// athlete between when admin #1 previews and when admin #1 commits.
// Without the re-run check, admin #1's commit would silently overwrite
// the other admin's change. The check refuses the commit and forces a
// fresh preview, surfacing the divergence to the operator.
//
// Per `.agents/rules/security-baseline.md`:
//   - Bodies validated at the edge with Zod (`.strict()`).
//   - Reads and writes are pinned to `c.var.auth.orgId` (defence in
//     depth on top of the role gate). An org_admin in org A cannot
//     touch org B's memberships.
//   - The dev_admin (platform-root) role admits to the admin tree via
//     the role gate's short-circuit; it is required to supply an
//     orgId via `?orgId=…` — mirroring the teams / roster pattern.
//   - Error envelopes carry `{ success: false, error: { code, message } }`
//     with no stack traces or internal class names.

import { athleteMemberships, teams } from '@repo/shared/db/schema';
import {
  type MembershipSnapshot,
  type RolloverChoice,
  buildPlan,
} from '@repo/shared/rollover/buildPlan';
import {
  RolloverCommitInputSchema,
  type RolloverPlanOutput,
  RolloverPreviewInputSchema,
} from '@repo/shared/schemas/admin/rollover';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import type { RequireInternalUserEnv } from '../../../middleware/auth';

// ── Error taxonomy ─────────────────────────────────────────────────────────

type RolloverErrorCode = 'INVALID_BODY' | 'MISSING_ORG_SCOPE' | 'STALE_PLAN' | 'INTERNAL';

interface RolloverErrorBody {
  readonly success: false;
  readonly error: {
    readonly code: RolloverErrorCode;
    readonly message: string;
  };
}

function errorBody(code: RolloverErrorCode, message: string): RolloverErrorBody {
  return { success: false, error: { code, message } };
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Resolve the org-scope for the request. An `org_admin` is pinned to
 * its own org by `c.var.auth.orgId`; a `dev_admin` may target any org
 * via `?orgId=…`. Returns `null` when no scope can be resolved.
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

interface MembershipRow {
  id: string;
  orgId: string;
  teamId: string;
  athleteUserId: string;
  endedAt: Date | null;
}

interface TeamRow {
  id: string;
  orgId: string;
  season: string;
}

/**
 * Structural shape of the Drizzle handle this router consumes. Mirrors
 * the pattern in `./teams.ts` and `./roster.ts`. The concrete handle is
 * an ephemeral better-sqlite3 instance in tests and an `@libsql/client`
 * proxy in production. `transaction` is required for commit; preview
 * does not need it.
 */
interface RolloverDb {
  select: () => {
    from: (table: typeof teams | typeof athleteMemberships) => {
      where: (predicate: unknown) => Promise<unknown[]>;
    };
  };
  // Sync transaction (better-sqlite3). The tx handle exposes the same
  // fluent surface as the parent db; writes use `.run()` to execute.
  transaction: <T>(fn: (tx: TxHandle) => T) => T;
}

interface TxHandle {
  insert: (table: typeof athleteMemberships) => {
    values: (rows: ReadonlyArray<typeof athleteMemberships.$inferInsert>) => {
      run: () => unknown;
    };
  };
  update: (table: typeof athleteMemberships) => {
    set: (patch: Partial<typeof athleteMemberships.$inferInsert>) => {
      where: (predicate: unknown) => {
        run: () => unknown;
      };
    };
  };
}

/**
 * Fetch all active source-season memberships for the supplied org. The
 * builder consumes the returned snapshots verbatim — the load-bearing
 * column set (`id`, `orgId`, `teamId`, `athleteUserId`, `endedAt`) maps
 * 1:1 to `MembershipSnapshot`.
 *
 * "Active" here means the source row is not already end-dated AND the
 * containing team is in the requested `sourceSeason`. Teams change
 * `season` rarely, but the join is necessary so that the rollover only
 * acts on memberships that genuinely belong to the season the operator
 * is rolling out of.
 */
async function fetchSourceMemberships(
  db: RolloverDb,
  orgId: string,
  sourceSeason: string,
): Promise<MembershipSnapshot[]> {
  // First pull the team ids in the source season for this org.
  const teamRows = (await db
    .select()
    .from(teams)
    .where(and(eq(teams.orgId, orgId), eq(teams.season, sourceSeason)))) as TeamRow[];
  const teamIds = teamRows.map((t) => t.id);
  if (teamIds.length === 0) return [];

  // Then pull the active memberships joined to those teams.
  const membershipRows = (await db
    .select()
    .from(athleteMemberships)
    .where(
      and(
        eq(athleteMemberships.orgId, orgId),
        inArray(athleteMemberships.teamId, teamIds),
        isNull(athleteMemberships.endedAt),
      ),
    )) as MembershipRow[];

  return membershipRows.map((r) => ({
    id: r.id,
    orgId: r.orgId,
    teamId: r.teamId,
    athleteUserId: r.athleteUserId,
    endedAt: r.endedAt,
  }));
}

/**
 * Project the builder output to the wire shape. The two are already
 * isomorphic — this just narrows the readonly arrays to mutable shapes
 * the Zod parser will accept on the round trip from the client.
 */
function planToWire(plan: ReturnType<typeof buildPlan>): RolloverPlanOutput {
  return {
    archives: plan.archives.map((a) => ({ ...a })),
    promotions: plan.promotions.map((p) => ({ ...p })),
    errors: plan.errors.map((e) => ({ ...e })),
  };
}

/**
 * Stable JSON serialization for the plan-equality check. The builder
 * already sorts its outputs deterministically, so a straight
 * `JSON.stringify` over the canonical shape is sufficient — there is
 * no need for a sort-keys helper.
 */
function planFingerprint(plan: RolloverPlanOutput): string {
  return JSON.stringify(plan);
}

// ── Router ─────────────────────────────────────────────────────────────────

export const rolloverAdminRoute = new Hono<RequireInternalUserEnv>();

/**
 * POST /api/v1/admin/rollover/preview
 *
 * No DB write. Returns `{ success: true, data: { plan } }` with the
 * canonical `RolloverPlan` shape.
 */
rolloverAdminRoute.post('/preview', async (c) => {
  const orgId = resolveOrgScope(c);
  if (!orgId) {
    return c.json(errorBody('MISSING_ORG_SCOPE', 'Actor has no orgId in scope.'), 400);
  }

  const rawBody: unknown = await c.req.json().catch(() => null);
  if (rawBody === null) {
    return c.json(errorBody('INVALID_BODY', 'Request body must be valid JSON.'), 400);
  }
  const parsed = RolloverPreviewInputSchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json(
      errorBody('INVALID_BODY', parsed.error.issues[0]?.message ?? 'Invalid body.'),
      400,
    );
  }
  const input = parsed.data;

  const db = c.get('db') as RolloverDb;
  const memberships = await fetchSourceMemberships(db, orgId, input.sourceSeason);
  const plan = buildPlan(memberships, input.choices as RolloverChoice[]);

  return c.json({ success: true, data: { plan: planToWire(plan) } }, 200);
});

/**
 * POST /api/v1/admin/rollover/commit
 *
 * Transactional. Re-runs `buildPlan` server-side against the CURRENT
 * source-season snapshot and refuses with 409 STALE_PLAN if the
 * recomputed plan differs from the `expectedPlan` carried in the
 * request. On equal plans, applies all writes inside one transaction
 * and returns `{ success: true, data: { applied: { archived, promoted, errors } } }`.
 */
rolloverAdminRoute.post('/commit', async (c) => {
  const orgId = resolveOrgScope(c);
  if (!orgId) {
    return c.json(errorBody('MISSING_ORG_SCOPE', 'Actor has no orgId in scope.'), 400);
  }

  const rawBody: unknown = await c.req.json().catch(() => null);
  if (rawBody === null) {
    return c.json(errorBody('INVALID_BODY', 'Request body must be valid JSON.'), 400);
  }
  const parsed = RolloverCommitInputSchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json(
      errorBody('INVALID_BODY', parsed.error.issues[0]?.message ?? 'Invalid body.'),
      400,
    );
  }
  const input = parsed.data;

  const db = c.get('db') as RolloverDb;
  if (typeof db.transaction !== 'function') {
    return c.json(errorBody('INTERNAL', 'Service temporarily unavailable.'), 500);
  }

  // Re-fetch the live source-season snapshot and recompute the plan.
  const memberships = await fetchSourceMemberships(db, orgId, input.sourceSeason);
  const recomputed = planToWire(buildPlan(memberships, input.choices as RolloverChoice[]));

  // STALE_PLAN check. The builder is deterministic + the outputs are
  // sorted, so a structural inequality means the underlying DB state
  // moved between preview and commit (a membership ended, a new one
  // appeared, or one moved teams). Refuse without writing.
  if (planFingerprint(recomputed) !== planFingerprint(input.expectedPlan)) {
    return c.json(
      errorBody(
        'STALE_PLAN',
        'The underlying roster has changed since preview. Re-run preview and try again.',
      ),
      409,
    );
  }

  // Apply the plan transactionally. Any throw inside the callback
  // rolls back every write.
  const now = new Date();
  let archivedCount = 0;
  let promotedCount = 0;
  try {
    db.transaction((tx) => {
      // End-date every source membership in the plan. One UPDATE per
      // membership keeps the SQL trivial and the failure surface small;
      // the bulk size here is bounded by the .max(5000) cap on the
      // request schema.
      for (const archive of recomputed.archives) {
        // Defence in depth: pin orgId on the WHERE clause so a row
        // somehow seeded into the wrong org cannot be touched from
        // this surface.
        tx.update(athleteMemberships)
          .set({ endedAt: now, updatedAt: now })
          .where(
            and(
              eq(athleteMemberships.id, archive.membershipId),
              eq(athleteMemberships.orgId, orgId),
            ),
          )
          .run();
        archivedCount += 1;
      }
      // Insert each promotion as a new active membership on the target
      // team. The cross-tenant CHECK trigger on `athlete_memberships`
      // enforces that target team and athlete user share the same org
      // as the membership row.
      for (const promotion of recomputed.promotions) {
        tx.insert(athleteMemberships)
          .values([
            {
              id: `am_${randomUUID()}`,
              orgId: promotion.orgId,
              teamId: promotion.targetTeamId,
              athleteUserId: promotion.athleteUserId,
            },
          ])
          .run();
        promotedCount += 1;
      }
    });
  } catch (_err) {
    // Do NOT leak the raw error message — it can carry SQL fragments
    // or constraint names. Keep the wire shape constant.
    return c.json(errorBody('INTERNAL', 'Failed to apply rollover plan.'), 500);
  }

  return c.json(
    {
      success: true,
      data: {
        applied: {
          archived: archivedCount,
          promoted: promotedCount,
          errors: recomputed.errors.length,
        },
        plan: recomputed,
      },
    },
    200,
  );
});
