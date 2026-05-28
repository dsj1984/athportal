// apps/api/src/routes/v1/admin/invitations/router.ts
//
// Real implementation of the `/api/v1/admin/invitations` sub-router
// (Epic #10 / Story #655 / Task #668; athlete POST added in Story
// #662 / Task #680). Replaces the placeholder shipped by Story #654
// (Task #658) on a one-file swap — the mount point in
// `apps/api/src/routes/v1/admin/index.ts` does not change.
//
// Endpoints:
//
//   GET    /                 → list pending invitations, scoped to the
//                              actor's org. Response is
//                              { success: true, data: [...] }.
//   POST   /athlete          → create a direct athlete invitation pinned
//                              to a single team in the actor's org.
//                              Returns 201 + envelope. A teamId belonging
//                              to a different org returns 404 NOT_FOUND
//                              (no cross-tenant existence oracle).
//   POST   /:id/resend       → call the Clerk wrapper's resend path
//                              (revoke + recreate), update the local
//                              row's clerk_invitation_id to the new
//                              id, and return 200. Status stays
//                              'pending'.
//   POST   /:id/revoke       → call the Clerk wrapper's revoke path,
//                              flip the local status to 'revoked'.
//                              Subsequent GET / excludes the row.
//
// Tenant isolation is enforced by reading `c.var.auth.orgId` and
// prefixing every DB read/write with `where org_id = :actor_org_id`.
// A request from org A that names a row owned by org B is refused
// with 403 FORBIDDEN — we deliberately do NOT return 404 here so the
// cross-tenant probe surfaces the same wire shape as a same-org RBAC
// denial. The contract test at
// `apps/api/src/routes/v1/admin/invitations/management.contract.test.ts`
// pins this contract.

import { randomUUID } from 'node:crypto';
import { createClerkClient } from '@clerk/backend';
import { type Invitation, invitations, teams } from '@repo/shared/db/schema';
import {
  AthleteInvitationCreateInputSchema,
  CoachInvitationCreateInputSchema,
} from '@repo/shared/schemas/admin/invitations';
import { and, eq, inArray } from 'drizzle-orm';
import { Hono, type MiddlewareHandler } from 'hono';
import {
  type ClerkInvitationClient,
  asInvitationClient,
  createInvitation,
  resendInvitation,
  revokeInvitation,
} from '../../../../lib/clerk-invitations';
import type { RequireInternalUserEnv } from '../../../../middleware/auth';

/**
 * Production wiring builds the Clerk client from `c.env.CLERK_SECRET_KEY`
 * lazily on the first call inside an invitations-router request (see
 * `requireClerkInvitationClient` below). Contract tests inject a
 * hand-rolled stub via `c.set('clerkInvitationClient', stub)` upstream
 * of the router; the middleware short-circuits when the variable is
 * already populated so the test seam still wins. Story #970 wired the
 * lazy construction this comment originally promised.
 */
interface InvitationsRouterVariables {
  clerkInvitationClient?: ClerkInvitationClient;
}

type InvitationsRouterEnv = RequireInternalUserEnv & {
  Variables: RequireInternalUserEnv['Variables'] & InvitationsRouterVariables;
};

type ErrorCode = 'FORBIDDEN' | 'NOT_FOUND' | 'BAD_REQUEST' | 'INVALID_BODY' | 'INTERNAL';

interface ErrorBody {
  readonly success: false;
  readonly error: { readonly code: ErrorCode; readonly message: string };
}

function errorBody(code: ErrorCode, message: string): ErrorBody {
  return { success: false, error: { code, message } };
}

/**
 * Narrowed Drizzle surface used by this router. Centralising the shape
 * keeps the call sites honest and lets the contract test pass any
 * better-sqlite3 / libsql handle that exposes these four verbs.
 */
interface TeamRowLike {
  readonly id: string;
  readonly orgId: string;
}

interface DrizzleLike {
  select(): {
    from(table: typeof invitations): {
      where(predicate: unknown): { all(): readonly Invitation[] };
    };
  };
  insert(table: typeof invitations): {
    values(values: typeof invitations.$inferInsert): { run(): void };
  };
  update(table: typeof invitations): {
    set(values: Partial<typeof invitations.$inferInsert>): {
      where(predicate: unknown): { run(): void };
    };
  };
}

/**
 * Narrower view of the Drizzle handle for `teams` lookups — kept
 * separate from `DrizzleLike` so the teams read can be stubbed
 * independently in unit-level slicing if a future refactor needs it.
 * The teams contract test exercises the production read.
 */
interface TeamsReadDb {
  select(): {
    from(table: typeof teams): {
      where(predicate: unknown): { all(): readonly TeamRowLike[] };
    };
  };
}

function narrowTeamsDb(db: unknown): TeamsReadDb {
  return db as TeamsReadDb;
}

function narrowDb(db: unknown): DrizzleLike {
  return db as DrizzleLike;
}

/**
 * Project the wire-shape row returned by the list endpoint. The full
 * persisted row carries audit columns (createdAt, updatedAt,
 * invitedByUserId, clerkInvitationId) the admin UI does not need —
 * we filter to the four fields the Tech Spec pins.
 */
interface PendingInvitationWire {
  readonly id: string;
  readonly email: string;
  readonly role: Invitation['role'];
  readonly teamIds: readonly string[];
  readonly status: Invitation['status'];
  readonly createdAt: number;
}

function toWire(row: Invitation): PendingInvitationWire {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    teamIds: Array.isArray(row.teamIds) ? row.teamIds : [],
    status: row.status,
    createdAt: row.createdAt instanceof Date ? row.createdAt.getTime() : Number(row.createdAt),
  };
}

/**
 * Lazily construct the `ClerkInvitationClient` on the first invitations
 * request when no pre-seeded stub is present. Reads
 * `c.env.CLERK_SECRET_KEY`, validates it carries a recognised Clerk
 * secret prefix (`sk_test_` or `sk_live_`), and builds the wrapper via
 * `asInvitationClient(createClerkClient({ secretKey }))`.
 *
 * Per `.agents/rules/security-baseline.md` (Secrets Management, Output
 * & Rendering): a missing or malformed secret surfaces the same opaque
 * `INTERNAL: Invitation client unavailable.` envelope the per-route
 * guards already emit — operators triage via the structured warn log,
 * never via response detail. The secret value itself is NEVER logged.
 *
 * The middleware is a no-op when `c.get('clerkInvitationClient')` is
 * already set so contract tests that inject a stub via an upstream
 * middleware keep working unchanged.
 */
function requireClerkInvitationClient(): MiddlewareHandler<InvitationsRouterEnv> {
  return async (c, next) => {
    if (c.get('clerkInvitationClient')) {
      await next();
      return;
    }
    const secretKey = c.env?.CLERK_SECRET_KEY;
    if (
      typeof secretKey !== 'string' ||
      (!secretKey.startsWith('sk_test_') && !secretKey.startsWith('sk_live_'))
    ) {
      try {
        console.warn(
          JSON.stringify({
            scope: 'admin-invitations',
            reason: 'clerk-secret-missing-or-malformed',
          }),
        );
      } catch {
        // intentional swallow — logging must never turn into a 500
      }
      return c.json(errorBody('INTERNAL', 'Invitation client unavailable.'), 500);
    }
    const client = asInvitationClient(createClerkClient({ secretKey }));
    c.set('clerkInvitationClient', client);
    await next();
    return;
  };
}

export const invitationsAdminRouter = new Hono<InvitationsRouterEnv>();

invitationsAdminRouter.use('*', requireClerkInvitationClient());

invitationsAdminRouter.get('/', (c) => {
  const auth = c.get('auth');
  const orgId = auth.orgId;
  if (!orgId) {
    // An org_admin without an org id is a misconfiguration — surface
    // as FORBIDDEN rather than crashing or returning an empty list
    // (which would silently hide invitations to a misconfigured
    // tenant).
    return c.json(errorBody('FORBIDDEN', 'Actor has no org context.'), 403);
  }

  const db = narrowDb(c.get('db'));
  const rows = db
    .select()
    .from(invitations)
    .where(and(eq(invitations.orgId, orgId), eq(invitations.status, 'pending')))
    .all();

  return c.json({ success: true, data: rows.map(toWire) }, 200);
});

/**
 * POST /api/v1/admin/invitations/athlete
 *
 * Direct athlete-invitation creation (Story #662 / Task #680).
 *
 * Pins the invitation to a single team in the actor's org. The
 * server NEVER trusts the caller's role claim — `role` is hard-coded
 * to `'athlete'` on the inserted row, and the Zod schema's
 * `.strict()` rejects a forged `role` field at the boundary.
 *
 * Tenant isolation:
 *   - The `teamId` is looked up with `where teamId = :id AND orgId =
 *     :actor_org_id`. A teamId belonging to a different org returns
 *     `404 NOT_FOUND` — same wire shape as a non-existent id, so
 *     cross-tenant probes do not surface an existence oracle.
 *   - The persisted row carries `orgId = :actor_org_id` so subsequent
 *     management surface reads (list/resend/revoke) keep the row
 *     scoped to the issuing org.
 *
 * The Clerk wrapper is called BEFORE the local row is inserted so a
 * third-party failure does not orphan a `pending` row with no live
 * Clerk invitation behind it.
 */
invitationsAdminRouter.post('/athlete', async (c) => {
  const auth = c.get('auth');
  const orgId = auth.orgId;
  if (!orgId) {
    return c.json(errorBody('FORBIDDEN', 'Actor has no org context.'), 403);
  }

  const rawBody: unknown = await c.req.json().catch(() => null);
  if (rawBody === null) {
    return c.json(errorBody('INVALID_BODY', 'Request body must be valid JSON.'), 400);
  }
  const parsed = AthleteInvitationCreateInputSchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json(
      errorBody('INVALID_BODY', parsed.error.issues[0]?.message ?? 'Invalid body.'),
      400,
    );
  }
  const input = parsed.data;

  // Verify the team exists AND belongs to the actor's org. A teamId
  // owned by a different org returns the same 404 as a missing id so
  // the surface is not a cross-tenant existence oracle.
  const teamsDb = narrowTeamsDb(c.get('db'));
  const teamRows = teamsDb
    .select()
    .from(teams)
    .where(and(eq(teams.id, input.teamId), eq(teams.orgId, orgId)))
    .all();
  if (teamRows.length === 0) {
    return c.json(errorBody('NOT_FOUND', 'Team not found.'), 404);
  }

  const client = c.get('clerkInvitationClient');
  if (!client) {
    return c.json(errorBody('INTERNAL', 'Invitation client unavailable.'), 500);
  }

  let created: { clerkInvitationId: string };
  try {
    created = await createInvitation(client, {
      email: input.email,
      orgId,
      role: 'athlete',
      teamIds: [input.teamId],
    });
  } catch {
    return c.json(errorBody('INTERNAL', 'Failed to create invitation.'), 502);
  }

  const db = narrowDb(c.get('db'));
  const newId = `inv_${randomUUID()}`;
  const now = new Date();
  db.insert(invitations)
    .values({
      id: newId,
      orgId,
      email: input.email,
      role: 'athlete',
      teamIds: [input.teamId],
      clerkInvitationId: created.clerkInvitationId,
      status: 'pending',
      invitedByUserId: auth.userId,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  return c.json(
    {
      success: true,
      data: {
        id: newId,
        email: input.email,
        role: 'athlete' as const,
        teamIds: [input.teamId],
        status: 'pending' as const,
        createdAt: now.getTime(),
      },
    },
    201,
  );
});

/**
 * POST /api/v1/admin/invitations/coach
 *
 * Coach invitation creation (Epic #10 / Story #664 / Task #684).
 *
 * Pins the invitation to one or more existing teams in the actor's
 * org. Coach invites without a team have no operational meaning
 * (Epic body), so the Zod schema rejects an empty `teamIds` array at
 * the boundary with 400 INVALID_BODY. The server NEVER trusts the
 * caller's role claim — `role` is hard-coded to `'coach'` on the
 * inserted row, and the schema's `.strict()` rejects a forged `role`
 * field.
 *
 * Tenant isolation:
 *   - Every requested teamId is looked up with `where teamId IN (:ids)
 *     AND orgId = :actor_org_id`. If any teamId fails to resolve under
 *     the actor's org (because it is missing or belongs to a different
 *     org) the request is refused with `404 NOT_FOUND` — same wire
 *     shape as a non-existent id, so cross-tenant probes do not
 *     surface an existence oracle.
 *   - The persisted row carries `orgId = :actor_org_id` so subsequent
 *     management surface reads (list/resend/revoke) keep the row
 *     scoped to the issuing org.
 *
 * The Clerk wrapper is called BEFORE the local row is inserted so a
 * third-party failure does not orphan a `pending` row with no live
 * Clerk invitation behind it.
 */
invitationsAdminRouter.post('/coach', async (c) => {
  const auth = c.get('auth');
  const orgId = auth.orgId;
  if (!orgId) {
    return c.json(errorBody('FORBIDDEN', 'Actor has no org context.'), 403);
  }

  const rawBody: unknown = await c.req.json().catch(() => null);
  if (rawBody === null) {
    return c.json(errorBody('INVALID_BODY', 'Request body must be valid JSON.'), 400);
  }
  const parsed = CoachInvitationCreateInputSchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json(
      errorBody('INVALID_BODY', parsed.error.issues[0]?.message ?? 'Invalid body.'),
      400,
    );
  }
  const input = parsed.data;

  // Verify every requested team exists AND belongs to the actor's
  // org. A teamId owned by a different org returns the same 404 as a
  // missing id so the surface is not a cross-tenant existence oracle.
  // We resolve the full set in a single query and compare cardinality
  // against the requested set to detect partial matches without
  // surfacing which id failed.
  const requestedTeamIds = Array.from(new Set(input.teamIds));
  const teamsDb = narrowTeamsDb(c.get('db'));
  const teamRows = teamsDb
    .select()
    .from(teams)
    .where(and(inArray(teams.id, requestedTeamIds), eq(teams.orgId, orgId)))
    .all();
  if (teamRows.length !== requestedTeamIds.length) {
    return c.json(errorBody('NOT_FOUND', 'Team not found.'), 404);
  }

  const client = c.get('clerkInvitationClient');
  if (!client) {
    return c.json(errorBody('INTERNAL', 'Invitation client unavailable.'), 500);
  }

  let created: { clerkInvitationId: string };
  try {
    created = await createInvitation(client, {
      email: input.email,
      orgId,
      role: 'coach',
      teamIds: requestedTeamIds,
    });
  } catch {
    return c.json(errorBody('INTERNAL', 'Failed to create invitation.'), 502);
  }

  const db = narrowDb(c.get('db'));
  const newId = `inv_${randomUUID()}`;
  const now = new Date();
  db.insert(invitations)
    .values({
      id: newId,
      orgId,
      email: input.email,
      role: 'coach',
      teamIds: requestedTeamIds,
      clerkInvitationId: created.clerkInvitationId,
      status: 'pending',
      invitedByUserId: auth.userId,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  return c.json(
    {
      success: true,
      data: {
        id: newId,
        email: input.email,
        role: 'coach' as const,
        teamIds: requestedTeamIds,
        status: 'pending' as const,
        createdAt: now.getTime(),
      },
    },
    201,
  );
});

invitationsAdminRouter.post('/:id/resend', async (c) => {
  const auth = c.get('auth');
  const orgId = auth.orgId;
  if (!orgId) {
    return c.json(errorBody('FORBIDDEN', 'Actor has no org context.'), 403);
  }

  const id = c.req.param('id');
  const db = narrowDb(c.get('db'));

  const existing = db.select().from(invitations).where(eq(invitations.id, id)).all()[0];

  if (!existing) {
    return c.json(errorBody('NOT_FOUND', 'Invitation not found.'), 404);
  }
  if (existing.orgId !== orgId) {
    // Cross-tenant probe — same wire shape as an RBAC denial.
    return c.json(errorBody('FORBIDDEN', 'You are not authorized to access this resource.'), 403);
  }
  if (existing.status !== 'pending') {
    return c.json(
      errorBody('BAD_REQUEST', `Cannot resend an invitation in '${existing.status}' status.`),
      400,
    );
  }

  const client = c.get('clerkInvitationClient');
  if (!client) {
    return c.json(errorBody('INTERNAL', 'Invitation client unavailable.'), 500);
  }

  const teamIdList = Array.isArray(existing.teamIds) ? existing.teamIds : [];
  let resent: { clerkInvitationId: string };
  try {
    resent = await resendInvitation(client, {
      email: existing.email,
      orgId,
      role: existing.role,
      teamIds: teamIdList,
      previousClerkInvitationId: existing.clerkInvitationId,
    });
  } catch {
    // Per security-baseline § Output & Rendering: no third-party
    // error detail reaches the caller.
    return c.json(errorBody('INTERNAL', 'Failed to resend invitation.'), 502);
  }

  db.update(invitations)
    .set({ clerkInvitationId: resent.clerkInvitationId, updatedAt: new Date() })
    .where(eq(invitations.id, id))
    .run();

  return c.json({ success: true }, 200);
});

invitationsAdminRouter.post('/:id/revoke', async (c) => {
  const auth = c.get('auth');
  const orgId = auth.orgId;
  if (!orgId) {
    return c.json(errorBody('FORBIDDEN', 'Actor has no org context.'), 403);
  }

  const id = c.req.param('id');
  const db = narrowDb(c.get('db'));

  const existing = db.select().from(invitations).where(eq(invitations.id, id)).all()[0];

  if (!existing) {
    return c.json(errorBody('NOT_FOUND', 'Invitation not found.'), 404);
  }
  if (existing.orgId !== orgId) {
    return c.json(errorBody('FORBIDDEN', 'You are not authorized to access this resource.'), 403);
  }
  if (existing.status === 'revoked') {
    // Idempotent — return 200 without re-calling Clerk.
    return c.json({ success: true, idempotent: true }, 200);
  }

  const client = c.get('clerkInvitationClient');
  if (!client) {
    return c.json(errorBody('INTERNAL', 'Invitation client unavailable.'), 500);
  }

  try {
    await revokeInvitation(client, existing.clerkInvitationId);
  } catch {
    return c.json(errorBody('INTERNAL', 'Failed to revoke invitation.'), 502);
  }

  db.update(invitations)
    .set({ status: 'revoked', updatedAt: new Date() })
    .where(eq(invitations.id, id))
    .run();

  return c.json({ success: true }, 200);
});
