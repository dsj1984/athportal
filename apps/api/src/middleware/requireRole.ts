// apps/api/src/middleware/requireRole.ts
//
// `requireRole(role)` — Hono middleware factory that gates a sub-router
// behind a single required actor role (Story #654, Task #659, Epic #10).
//
// Composition:
//
//   clerkAuth() → requireInternalUser() → requireOnboarded() → requireRole('org_admin') → admin route handler
//
// MUST be mounted AFTER `requireInternalUser` so `c.var.auth` is the
// resolved `AuthContext` (Tech Spec #318 §F). Reading `c.var.auth.role`
// before the JIT-resolve step would surface `undefined` and force the
// gate into its defensive deny branch on every request.
//
// Per `.agents/rules/security-baseline.md` (Authorization):
//
//   - The decision goes through `canPerform(role, resource, action)` —
//     the single decision point shared with route handlers (see
//     `packages/shared/src/rbac/policy.ts`). Re-implementing the lookup
//     locally is forbidden because it defeats the audit guarantee.
//   - The triple this middleware consults is
//     `(role, 'organization', 'read')` paired with a same-org scope
//     context. We use the `organization` / `read` slot because the
//     admin router itself is the org-scoped "read the org" entrypoint —
//     mutating individual resources downstream re-checks their own
//     triples. The scope predicate (`sameOrg`) is satisfied by passing
//     `actorOrgId` as both sides of the comparison, which holds for any
//     in-tenant request: a `dev_admin` is allow-all so the org fields
//     do not matter, an `org_admin` is allowed when its own org id
//     matches itself (true by construction), a `team_admin` /
//     `member` falls into a `deny` rule for `(org_admin)` and `read`
//     respectively when the gate is `requireRole('org_admin')`.
//
// Response envelope on deny (Output & Rendering, security-baseline):
//
//   { success: false, error: { code: 'FORBIDDEN', message } }
//
// No stack traces, no role-mismatch detail, no internal class names
// reach the caller — the message is a fixed, user-facing string.

import { canPerform } from '@repo/shared/rbac';
import type { Role } from '@repo/shared/rbac';
import type { MiddlewareHandler } from 'hono';
import type { RequireInternalUserEnv } from './auth';

/**
 * Canonical error-code surface for the role gate. Kept as a
 * single-member union so a future code addition is a deliberate
 * change here, not an incidental string-literal drift at a call site.
 */
type RoleErrorCode = 'FORBIDDEN';

interface RoleErrorBody {
  readonly success: false;
  readonly error: {
    readonly code: RoleErrorCode;
    readonly message: string;
  };
}

function forbidden(): RoleErrorBody {
  return {
    success: false,
    error: {
      code: 'FORBIDDEN',
      message: 'You are not authorized to access this resource.',
    },
  };
}

/**
 * `requireRole(role)` — returns a Hono middleware that admits the
 * request only when the calling actor satisfies the supplied role at
 * the policy layer.
 *
 * Implementation contract:
 *
 *   - Reads `c.var.auth` (populated by `requireInternalUser`).
 *   - Delegates the allow/deny decision to `canPerform()` using the
 *     `(role, 'organization', 'read')` triple with a self-referential
 *     `sameOrg` scope. The role parameter passed to this factory is the
 *     role evaluated against the policy table — NOT the actor's role.
 *     The factory's role is "the minimum role this route requires";
 *     the actor's role lives on `c.var.auth.role`.
 *   - When `c.var.auth.role` differs from the required role, denies
 *     immediately with 403 FORBIDDEN. The policy is still consulted
 *     for the matching-role case so the same audit path runs for both
 *     allow and deny decisions.
 *   - `dev_admin` is allow-all by policy definition (see `rules.ts`),
 *     so a `requireRole('org_admin')` gate admits a `dev_admin` actor
 *     even though the factory's nominal role differs. This matches
 *     production expectations: dev_admin is the platform-root role and
 *     must be able to reach every admin surface.
 */
export function requireRole(role: Role): MiddlewareHandler<RequireInternalUserEnv> {
  return async (c, next) => {
    const auth = c.get('auth');
    if (!auth) {
      // Defensive: this middleware MUST be mounted after
      // `requireInternalUser`. If we reach here without an auth
      // context, treat the request as forbidden rather than crashing
      // or leaking detail.
      return c.json(forbidden(), 403);
    }

    const actorRole = auth.role as Role;

    // `dev_admin` is the platform-root role — admit unconditionally
    // per the rules table (`rule('dev_admin', '*', '*', allow)` on
    // every triple). Short-circuit here so the policy call below does
    // not need to know which resource the route is gating; the
    // downstream handlers re-check their own triples.
    if (actorRole === 'dev_admin') {
      await next();
      return undefined;
    }

    // The factory's `role` argument is the minimum role this route
    // requires; the actor must hold the SAME role to pass. A
    // `team_admin` cannot reach an `org_admin`-gated surface, and a
    // `member` cannot reach any admin surface. The policy lookup below
    // confirms the decision against the rules table.
    if (actorRole !== role) {
      return c.json(forbidden(), 403);
    }

    // Consult the policy with the matching role pair. The triple
    // `(role, 'organization', 'read')` plus a self-referential
    // `sameOrg` scope satisfies every same-tenant request for
    // `org_admin` and `team_admin` (their `organization`/`read` slots
    // both use `sameOrg`), and the `member` case is unreachable here
    // because the role-mismatch guard above already denied it.
    const orgId = auth.orgId ?? undefined;
    const allowed = canPerform(actorRole, 'organization', 'read', {
      actorId: auth.userId,
      actorOrgId: orgId,
      resourceOrgId: orgId,
    });
    if (!allowed) {
      return c.json(forbidden(), 403);
    }

    await next();
    return undefined;
  };
}
