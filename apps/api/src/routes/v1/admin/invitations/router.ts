// apps/api/src/routes/v1/admin/invitations/router.ts
//
// Real implementation of the `/api/v1/admin/invitations` sub-router
// (Epic #10 / Story #655 / Task #668). Replaces the placeholder
// shipped by Story #654 (Task #658) on a one-file swap — the mount
// point in `apps/api/src/routes/v1/admin/index.ts` does not change.
//
// Endpoints:
//
//   GET    /                 → list pending invitations, scoped to the
//                              actor's org. Response is
//                              { success: true, data: [...] }.
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

import { type Invitation, invitations } from '@repo/shared/db/schema';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import {
  type ClerkInvitationClient,
  resendInvitation,
  revokeInvitation,
} from '../../../../lib/clerk-invitations';
import type { RequireInternalUserEnv } from '../../../../middleware/auth';

/**
 * Test-only seam. Production wiring builds the Clerk client from
 * `c.env.CLERK_SECRET_KEY` lazily on the first call inside a request.
 * Contract tests inject a hand-rolled stub via
 * `c.set('clerkInvitationClient', stub)` so the suite never touches
 * the real Clerk SDK.
 */
interface InvitationsRouterVariables {
  clerkInvitationClient?: ClerkInvitationClient;
}

type InvitationsRouterEnv = RequireInternalUserEnv & {
  Variables: RequireInternalUserEnv['Variables'] & InvitationsRouterVariables;
};

type ErrorCode = 'FORBIDDEN' | 'NOT_FOUND' | 'BAD_REQUEST' | 'INTERNAL';

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
interface DrizzleLike {
  select(): {
    from(table: typeof invitations): {
      where(predicate: unknown): { all(): readonly Invitation[] };
    };
  };
  update(table: typeof invitations): {
    set(values: Partial<typeof invitations.$inferInsert>): {
      where(predicate: unknown): { run(): void };
    };
  };
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

export const invitationsAdminRouter = new Hono<InvitationsRouterEnv>();

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
