// apps/api/src/routes/v1/admin/teams.ts
//
// Org-admin Team CRUD endpoints (Epic #10 / Story #657 / Task #678).
//
// Replaces the Story #654 placeholder. The router is mounted under
// `/api/v1/admin/teams` by `./index.ts`, which already runs
// `requireRole('org_admin')` for the entire admin tree — so every
// handler in this file can assume `c.var.auth.role === 'org_admin'`
// or `dev_admin` (the platform-root short-circuit).
//
// Per `.agents/rules/security-baseline.md` (Input Validation,
// Authorization, Output & Rendering):
//
//   - Every body is validated at the edge with a Zod schema from
//     `@repo/shared/schemas/admin/teams`. Unknown keys are a hard
//     400 INVALID_BODY (the schemas use `.strict()`).
//   - Every read and write is org-scoped against `c.var.auth.orgId` —
//     the path-id is NEVER trusted on its own. An org_admin in org A
//     hitting org B's team-id sees the same 404 as if the team did
//     not exist (no cross-tenant existence oracle).
//   - The dev_admin (platform-root) role admits to the admin tree via
//     the gate's short-circuit, but is required to supply an orgId via
//     `?orgId=` for read paths and to target an existing team for
//     mutate paths. Without an orgId scope dev_admin still cannot
//     enumerate every tenant's teams from this surface — by design.
//   - Responses carry the canonical envelope
//     `{ success: true, data: ... }` or
//     `{ success: false, error: { code, message } }` with no stack
//     traces or internal class names.
//
// Endpoints:
//
//   GET    /                        — list active teams (or archived
//                                     with ?archived=true)
//   POST   /                        — create a team (201 + envelope)
//   GET    /:id                     — read a single team
//   PATCH  /:id                     — partial update
//   POST   /:id/archive             — set archived_at to now()
//   POST   /:id/restore             — clear archived_at
//
// Tier: contract. The exhaustive cross-org isolation matrix lives in
// `./teams.contract.test.ts` alongside this file.

import { randomUUID } from 'node:crypto';
import { teams } from '@repo/shared/db/schema';
import {
  TeamCreateInputSchema,
  type TeamOutput,
  TeamOutputSchema,
  TeamUpdateInputSchema,
} from '@repo/shared/schemas/admin/teams';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import type { RequireInternalUserEnv } from '../../../middleware/auth';

// ── Error taxonomy ─────────────────────────────────────────────────────────

type TeamsErrorCode = 'INVALID_BODY' | 'NOT_FOUND' | 'FORBIDDEN' | 'MISSING_ORG_SCOPE';

interface TeamsErrorBody {
  readonly success: false;
  readonly error: {
    readonly code: TeamsErrorCode;
    readonly message: string;
  };
}

function errorBody(code: TeamsErrorCode, message: string): TeamsErrorBody {
  return { success: false, error: { code, message } };
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Resolve the org-scope to use for this request. An `org_admin` is pinned
 * to its own org by `c.var.auth.orgId`; a `dev_admin` may target any
 * org via `?orgId=…`. Returns `null` when the scope cannot be resolved
 * (the handler then short-circuits with `MISSING_ORG_SCOPE`).
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

interface TeamRow {
  id: string;
  orgId: string;
  name: string;
  sport: string;
  season: string;
  ageGroup: string;
  archivedAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Project a DB row to the public team shape. `deletedAt` is dropped on
 * purpose so the soft-delete cleanup column cannot leak through.
 */
function toPublicTeam(row: TeamRow): TeamOutput {
  return {
    id: row.id,
    orgId: row.orgId,
    name: row.name,
    sport: row.sport,
    season: row.season,
    ageGroup: row.ageGroup,
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// Structural shape of the Drizzle handle this router uses. Mirrors the
// `InternalUserDb` pattern in `apps/api/src/middleware/auth.ts`: the
// concrete handle is supplied at test time by `freshDb()` and at
// runtime by the Worker entrypoint.
interface TeamsDb {
  select: () => {
    from: (table: typeof teams) => {
      where: (predicate: unknown) => Promise<TeamRow[]> & {
        limit?: (n: number) => Promise<TeamRow[]>;
      };
    };
  };
  insert: (table: typeof teams) => {
    values: (row: typeof teams.$inferInsert) => {
      returning: () => Promise<TeamRow[]>;
    };
  };
  update: (table: typeof teams) => {
    set: (patch: Partial<typeof teams.$inferInsert>) => {
      where: (predicate: unknown) => {
        returning: () => Promise<TeamRow[]>;
      };
    };
  };
}

async function findOneTeam(db: TeamsDb, orgId: string, id: string): Promise<TeamRow | undefined> {
  const rows = await db
    .select()
    .from(teams)
    .where(and(eq(teams.id, id), eq(teams.orgId, orgId), isNull(teams.deletedAt)));
  return rows[0];
}

// ── Router ─────────────────────────────────────────────────────────────────

export const teamsAdminRoute = new Hono<RequireInternalUserEnv>();

/**
 * GET /api/v1/admin/teams
 *   ?archived=true → archived teams only
 *   default        → active (non-archived) teams only
 *
 * Always excludes rows in the 30-day soft-delete window (`deletedAt`).
 */
teamsAdminRoute.get('/', async (c) => {
  const orgId = resolveOrgScope(c);
  if (!orgId) {
    return c.json(errorBody('MISSING_ORG_SCOPE', 'Actor has no orgId in scope.'), 400);
  }
  const archivedParam = c.req.query('archived');
  const wantArchived = archivedParam === 'true';

  const db = c.get('db') as TeamsDb;
  const rows = await db
    .select()
    .from(teams)
    .where(
      and(
        eq(teams.orgId, orgId),
        isNull(teams.deletedAt),
        wantArchived ? isNotNull(teams.archivedAt) : isNull(teams.archivedAt),
      ),
    );

  return c.json({ success: true, data: rows.map(toPublicTeam) }, 200);
});

/**
 * POST /api/v1/admin/teams
 *
 * 201 + canonical envelope on success.
 */
teamsAdminRoute.post('/', async (c) => {
  const orgId = resolveOrgScope(c);
  if (!orgId) {
    return c.json(errorBody('MISSING_ORG_SCOPE', 'Actor has no orgId in scope.'), 400);
  }

  const rawBody: unknown = await c.req.json().catch(() => null);
  if (rawBody === null) {
    return c.json(errorBody('INVALID_BODY', 'Request body must be valid JSON.'), 400);
  }
  const parsed = TeamCreateInputSchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json(
      errorBody('INVALID_BODY', parsed.error.issues[0]?.message ?? 'Invalid body.'),
      400,
    );
  }
  const input = parsed.data;

  const db = c.get('db') as TeamsDb;
  const inserted = await db
    .insert(teams)
    .values({
      id: `t_${randomUUID()}`,
      orgId,
      name: input.name,
      sport: input.sport,
      season: input.season,
      ageGroup: input.ageGroup,
    })
    .returning();

  const row = inserted[0];
  if (!row) {
    return c.json(errorBody('INVALID_BODY', 'Insert returned no row.'), 400);
  }
  const projected = TeamOutputSchema.parse(toPublicTeam(row));
  return c.json({ success: true, data: projected }, 201);
});

/**
 * GET /api/v1/admin/teams/:id
 *
 * Returns 404 for any team that does not exist OR exists in a
 * different org (no cross-tenant existence oracle).
 */
teamsAdminRoute.get('/:id', async (c) => {
  const orgId = resolveOrgScope(c);
  if (!orgId) {
    return c.json(errorBody('MISSING_ORG_SCOPE', 'Actor has no orgId in scope.'), 400);
  }
  const id = c.req.param('id');
  const db = c.get('db') as TeamsDb;
  const row = await findOneTeam(db, orgId, id);
  if (!row) {
    return c.json(errorBody('NOT_FOUND', 'Team not found.'), 404);
  }
  return c.json({ success: true, data: toPublicTeam(row) }, 200);
});

/**
 * PATCH /api/v1/admin/teams/:id
 *
 * Partial update of any subset of (name, sport, season, ageGroup).
 * Refreshes `updated_at`.
 */
teamsAdminRoute.patch('/:id', async (c) => {
  const orgId = resolveOrgScope(c);
  if (!orgId) {
    return c.json(errorBody('MISSING_ORG_SCOPE', 'Actor has no orgId in scope.'), 400);
  }
  const id = c.req.param('id');

  const rawBody: unknown = await c.req.json().catch(() => null);
  if (rawBody === null) {
    return c.json(errorBody('INVALID_BODY', 'Request body must be valid JSON.'), 400);
  }
  const parsed = TeamUpdateInputSchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json(
      errorBody('INVALID_BODY', parsed.error.issues[0]?.message ?? 'Invalid body.'),
      400,
    );
  }

  const db = c.get('db') as TeamsDb;
  const existing = await findOneTeam(db, orgId, id);
  if (!existing) {
    return c.json(errorBody('NOT_FOUND', 'Team not found.'), 404);
  }

  const updated = await db
    .update(teams)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(and(eq(teams.id, id), eq(teams.orgId, orgId)))
    .returning();

  const row = updated[0];
  if (!row) {
    return c.json(errorBody('NOT_FOUND', 'Team not found.'), 404);
  }
  return c.json({ success: true, data: toPublicTeam(row) }, 200);
});

/**
 * POST /api/v1/admin/teams/:id/archive
 *
 * Sets `archived_at` to now(). Idempotent — archiving an already-archived
 * team is a 200 no-op (the timestamp is refreshed to keep the audit
 * trail honest).
 */
teamsAdminRoute.post('/:id/archive', async (c) => {
  const orgId = resolveOrgScope(c);
  if (!orgId) {
    return c.json(errorBody('MISSING_ORG_SCOPE', 'Actor has no orgId in scope.'), 400);
  }
  const id = c.req.param('id');

  const db = c.get('db') as TeamsDb;
  const existing = await findOneTeam(db, orgId, id);
  if (!existing) {
    return c.json(errorBody('NOT_FOUND', 'Team not found.'), 404);
  }

  const now = new Date();
  const updated = await db
    .update(teams)
    .set({ archivedAt: now, updatedAt: now })
    .where(and(eq(teams.id, id), eq(teams.orgId, orgId)))
    .returning();

  const row = updated[0];
  if (!row) {
    return c.json(errorBody('NOT_FOUND', 'Team not found.'), 404);
  }
  return c.json({ success: true, data: toPublicTeam(row) }, 200);
});

/**
 * POST /api/v1/admin/teams/:id/restore
 *
 * Clears `archived_at`. Idempotent.
 */
teamsAdminRoute.post('/:id/restore', async (c) => {
  const orgId = resolveOrgScope(c);
  if (!orgId) {
    return c.json(errorBody('MISSING_ORG_SCOPE', 'Actor has no orgId in scope.'), 400);
  }
  const id = c.req.param('id');

  const db = c.get('db') as TeamsDb;
  const existing = await findOneTeam(db, orgId, id);
  if (!existing) {
    return c.json(errorBody('NOT_FOUND', 'Team not found.'), 404);
  }

  const now = new Date();
  const updated = await db
    .update(teams)
    .set({ archivedAt: null, updatedAt: now })
    .where(and(eq(teams.id, id), eq(teams.orgId, orgId)))
    .returning();

  const row = updated[0];
  if (!row) {
    return c.json(errorBody('NOT_FOUND', 'Team not found.'), 404);
  }
  return c.json({ success: true, data: toPublicTeam(row) }, 200);
});
