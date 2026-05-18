// apps/api/src/routes/v1/users/role.ts
//
// PATCH /api/v1/users/:id/role — role update with last-admin enforcement
// (Story #340, Task #350, Tech Spec #318 §E).
//
// The last-admin invariant is implemented in TWO places by design:
//
//   1. Policy layer — `canPerform(role, 'user', 'update', { ...,
//      remainingAdminsAfter })` returns `false` when
//      `remainingAdminsAfter === 0`. The policy is pure: it does not
//      read the DB.
//   2. Service layer (this route) — reads the current org admin count
//      inside the SAME transaction as the update, computes
//      `remainingAdminsAfter`, and feeds it to `canPerform`. When the
//      policy denies because the count would drop to zero, the route
//      returns `409 CONFLICT` with the canonical envelope:
//
//        { success: false, error: { code: 'LAST_ADMIN', message: ... } }
//
//   The transaction rollback on deny guarantees no partial mutation
//   reaches storage: the update statement runs first, the post-update
//   count read runs second; if `canPerform` denies, the transaction
//   throws and SQLite/libSQL rolls everything back.
//
// Auth: mounted under `requireInternalUser` so `c.var.auth` is the
// resolved `AuthContext`. Other denial paths (403 FORBIDDEN) are
// emitted when the policy denies for a reason OTHER than the last-
// admin guard — e.g. an `org_admin` trying to mutate a user in a
// different org.

import { users } from '@repo/shared/db/schema';
import { canPerform } from '@repo/shared/rbac';
import type { Role } from '@repo/shared/rbac';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { RequireInternalUserEnv } from '../../../middleware/auth';

export const userRoleRoute = new Hono<RequireInternalUserEnv>();

/**
 * The set of roles considered "admin" for the last-admin invariant.
 * An org is "orphaned" the moment its last `org_admin` row is demoted
 * or deleted; `team_admin` is a sub-scope and does not satisfy the
 * top-level admin presence requirement, and `dev_admin` is platform-
 * level (not org-scoped).
 *
 * Kept narrow on purpose — widening this set would silently weaken
 * the invariant. Any future role with org-level admin powers MUST be
 * added here in lockstep with the corresponding `rules.ts` change.
 */
const ORG_ADMIN_ROLES = new Set<Role>(['org_admin']);

/**
 * Body schema accepted by the route. We don't pull in Zod for one
 * field — a small inline validator keeps the route self-contained and
 * the failure mode obvious.
 */
const VALID_ROLES: ReadonlySet<Role> = new Set(['dev_admin', 'org_admin', 'team_admin', 'member']);

interface PatchRoleBody {
  readonly role: Role;
}

function parseBody(payload: unknown): PatchRoleBody | null {
  if (payload === null || typeof payload !== 'object') return null;
  const role = (payload as { role?: unknown }).role;
  if (typeof role !== 'string') return null;
  if (!VALID_ROLES.has(role as Role)) return null;
  return { role: role as Role };
}

/**
 * Marker type for the Drizzle transaction handle. The handle is
 * carried as `unknown` for the same reason `InternalUserDb` is in the
 * auth middleware: different SQLite drivers expose slightly different
 * query-builder return types, and we only depend on the structural
 * subset we use here.
 */
interface TxHandle {
  update: (table: unknown) => DrizzleUpdateChain;
  select: (cols?: unknown) => DrizzleSelectChain;
}

interface DrizzleUpdateChain {
  set: (values: Record<string, unknown>) => {
    where: (predicate: unknown) => {
      returning: () => { all: () => Array<typeof users.$inferSelect> };
    };
  };
}

interface DrizzleSelectChain {
  from: (table: unknown) => {
    where: (predicate: unknown) => {
      all: () => Array<{ count: number }>;
    };
  };
}

interface TxDb {
  transaction: <T>(fn: (tx: TxHandle) => T) => T;
  select: (cols?: unknown) => DrizzleSelectChain;
}

/**
 * Sentinel thrown inside the transaction callback when the policy
 * denies the mutation. Catching it outside the transaction is what
 * lets the SQLite driver roll back the in-flight UPDATE.
 */
class LastAdminError extends Error {
  constructor() {
    super('LAST_ADMIN');
    this.name = 'LastAdminError';
  }
}

class ForbiddenError extends Error {
  constructor() {
    super('FORBIDDEN');
    this.name = 'ForbiddenError';
  }
}

class NotFoundError extends Error {
  constructor() {
    super('NOT_FOUND');
    this.name = 'NotFoundError';
  }
}

userRoleRoute.patch('/:id/role', async (c) => {
  const auth = c.get('auth');
  const targetId = c.req.param('id');

  const rawBody = (await c.req.json().catch(() => null)) as unknown;
  const body = parseBody(rawBody);
  if (!body) {
    return c.json(
      {
        success: false as const,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request body must be { role: <valid role> }.',
        },
      },
      400,
    );
  }

  const db = c.get('db') as TxDb;
  if (!db || typeof db.transaction !== 'function') {
    // Misconfiguration — the DB binding is required. Surface 500
    // without leaking internal detail.
    return c.json(
      {
        success: false as const,
        error: {
          code: 'INTERNAL',
          message: 'Service temporarily unavailable.',
        },
      },
      500,
    );
  }

  try {
    // The whole read-modify-decide sequence runs inside one
    // transaction so the post-update admin count is consistent
    // with the row we just wrote. On a deny (LastAdminError /
    // ForbiddenError) the throw unwinds and SQLite rolls back the
    // UPDATE — `remainingAdminsAfter === 0` rows never persist.
    const updated = db.transaction((tx) => {
      // 1. Apply the update first so the admin-count read below
      //    reflects the post-mutation state. We constrain the
      //    update so it only matches when the row actually exists;
      //    `returning()` then tells us whether the target was found.
      const rows = tx
        .update(users)
        .set({ role: body.role, updatedAt: new Date() })
        .where(eq(users.id, targetId))
        .returning()
        .all();

      const targetRow = rows[0];
      if (!targetRow) {
        throw new NotFoundError();
      }

      // 2. Determine the org we are reasoning about. For an
      //    `org_admin` actor, this is the actor's `orgId`; for a
      //    `dev_admin` actor, fall back to the target user's
      //    `orgId` (dev_admin can act cross-org). If neither is
      //    known we can't run the last-admin guard — refuse.
      const orgIdForCount = auth.orgId ?? targetRow.orgId ?? null;

      // 3. Read the post-update admin count for the relevant
      //    org. Counting ALL admin rows in the org satisfies the
      //    invariant; we count the row we just updated implicitly
      //    because the UPDATE has already landed in this
      //    transaction.
      let remainingAdminsAfter: number;
      if (orgIdForCount === null) {
        // No org scope to count against — for a dev_admin acting
        // on a user that has no org membership, the last-admin
        // invariant does not apply. Use a sentinel that satisfies
        // the policy (> 0).
        remainingAdminsAfter = Number.POSITIVE_INFINITY;
      } else {
        const countRows = tx
          .select({ count: sql<number>`count(*)` })
          .from(users)
          .where(
            and(
              eq(users.orgId, orgIdForCount),
              // Only count rows whose CURRENT role (post-update)
              // is in the admin set. Today the set is exactly
              // {org_admin}; the inArray() shape keeps the query
              // honest if the set ever grows.
              inArray(users.role, Array.from(ORG_ADMIN_ROLES)),
            ),
          )
          .all();
        remainingAdminsAfter = Number(countRows[0]?.count ?? 0);
      }

      // 4. Ask the policy. The pure decision is the source of
      //    truth — if it denies because remainingAdminsAfter is 0,
      //    we throw LastAdminError; for any other denial we throw
      //    ForbiddenError. Either throw rolls the UPDATE back.
      const allowed = canPerform(auth.role as Role, 'user', 'update', {
        actorId: auth.userId,
        actorOrgId: auth.orgId ?? undefined,
        actorTeamId: auth.teamId ?? undefined,
        resourceOrgId: targetRow.orgId ?? undefined,
        resourceOwnerId: targetRow.id,
        remainingAdminsAfter,
      });

      if (!allowed) {
        if (remainingAdminsAfter === 0) {
          throw new LastAdminError();
        }
        throw new ForbiddenError();
      }

      return targetRow;
    });

    return c.json(
      {
        success: true as const,
        data: {
          userId: updated.id,
          role: updated.role,
          orgId: updated.orgId ?? null,
          teamId: updated.teamId ?? null,
        },
      },
      200,
    );
  } catch (err) {
    if (err instanceof LastAdminError) {
      return c.json(
        {
          success: false as const,
          error: {
            code: 'LAST_ADMIN',
            message: 'Refusing role change: at least one admin must remain in the organization.',
          },
        },
        409,
      );
    }
    if (err instanceof ForbiddenError) {
      return c.json(
        {
          success: false as const,
          error: {
            code: 'FORBIDDEN',
            message: 'You are not authorized to change this user’s role.',
          },
        },
        403,
      );
    }
    if (err instanceof NotFoundError) {
      return c.json(
        {
          success: false as const,
          error: {
            code: 'NOT_FOUND',
            message: 'User not found.',
          },
        },
        404,
      );
    }
    // Unknown failure path. Per the security baseline (Output &
    // Rendering, Data Leakage & Logging) we MUST NOT echo the
    // internal class name, message, or stack to the caller.
    return c.json(
      {
        success: false as const,
        error: {
          code: 'INTERNAL',
          message: 'Request could not be completed.',
        },
      },
      500,
    );
  }
});
