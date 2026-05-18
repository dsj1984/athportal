// apps/api/src/middleware/__testing__/auth-test.ts
//
// Test-only auth adapter middleware (Story #342 / Task #354).
//
// Per Tech Spec #318 §F, contract tests need a way to drive the
// `/api/v1/*` chain without spinning up a real Clerk JWT verifier. This
// adapter swaps the JWT-validation step ONLY — it writes a supplied
// `AuthContext` directly into `c.var.auth` and yields to the next
// middleware. The downstream `requireInternalUser` middleware (Story
// #330) runs UNCHANGED in the test path: JIT users-row provisioning and
// role-check paths still execute against real production code, so the
// seam exercises the real behaviour under test.
//
// Load-bearing constraints:
//
//   1. This file lives under `__testing__/`. Production entry points
//      (`apps/api/src/index.ts`, `apps/web/src/middleware.ts`) MUST NOT
//      import from here. Task #355 ships the static-import guard that
//      enforces this at test time. Default `tsconfig.json` and Worker
//      build configs exclude `**/__testing__/**` so even an accidental
//      import is unbuildable.
//
//   2. The adapter ONLY substitutes the JWT-validator stage. It does
//      NOT bypass `requireInternalUser` — callers compose the chain so
//      that `authTest(actor)` runs in place of `clerkAuth()` and
//      `requireInternalUser()` still runs after. This is the load-
//      bearing design choice of the seam (Tech Spec #318 §G).
//
//   3. Inputs are strongly typed against the canonical `AuthContext`
//      from the production middleware. A test that omits a field fails
//      at compile time rather than at runtime.

import type { MiddlewareHandler } from 'hono';
import type { AuthContext, RequireInternalUserEnv } from '../auth';

/**
 * Build a Hono middleware that writes the supplied `AuthContext` into
 * `c.var.auth` (and the corresponding `clerkSubjectId` into
 * `c.var.clerkSubjectId`, so any downstream code that reads the raw
 * subject id continues to work) and then calls `next()`.
 *
 * The `actor` argument carries the full `AuthContext` shape — `userId`,
 * `clerkSubjectId`, `email`, `role`, `orgId`, and `teamId`. The function
 * signature requires every field; TypeScript rejects a partial object
 * at the call site.
 *
 * Usage in a contract test:
 *
 *   const app = new Hono<RequireInternalUserEnv>();
 *   app.use('*', async (c, next) => { c.set('db', db); await next(); });
 *   app.use('*', authTest({ userId, clerkSubjectId, email, role, orgId, teamId }));
 *   app.use('*', requireInternalUser());
 *   app.route('/api/v1/me', meRoute);
 *
 * The wrapper helper `createTestApp(db, { actor })` (Task #356)
 * encapsulates this composition for callers.
 */
export function authTest(actor: AuthContext): MiddlewareHandler<RequireInternalUserEnv> {
  return async (c, next) => {
    // Mirror what `clerkAuth` writes so any code reading the raw
    // subject id outside of the AuthContext (rare, but Tech Spec
    // #318 §G allows it) sees a consistent view.
    c.set('clerkSubjectId', actor.clerkSubjectId);
    c.set('auth', actor);
    await next();
    return undefined;
  };
}
