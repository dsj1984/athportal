// apps/api/src/middleware/withDb.ts
//
// Bridges the host-supplied DB binding into request context for every
// downstream middleware and route. Mounted before `requireInternalUser`
// so the JIT user-resolution path has a Drizzle handle to query
// (`RequireInternalUserVariables.db`), and stays in place for every
// `/api/v1/*` handler that reads `c.var.db` (admin tree, onboarding,
// user-role).
//
// The handle is *constructed by the host* (the dev server in
// `apps/api/src/local.ts` today; the Cloudflare Worker entrypoint in
// Epic #27) and passed in via the `DB` binding on `c.env`. This file is
// deliberately a thin pass-through: keeping the driver construction at
// the host boundary lets local-dev use `better-sqlite3` (native
// binding) while leaving room for Workers + `@libsql/client` to land
// without re-editing every route — the contract is `c.var.db`, not the
// driver type.
//
// Story #760.

import type { MiddlewareHandler } from 'hono';
import type { Env } from '../env';

/**
 * Marker type for the Drizzle handle passed in via `c.env.DB`.
 *
 * `unknown` mirrors the `InternalUserDb` rationale in
 * `./auth.ts` — the middleware is driver-agnostic, and downstream
 * consumers narrow the handle structurally to the methods they call.
 * Tightening this to a concrete `BetterSQLite3Database<…>` would force
 * every host (Workers, dev, future libsql) to satisfy the same shape
 * and drag both drivers' types into every consumer.
 */
export type DbHandle = unknown;

interface WithDbVariables {
  db: DbHandle;
}

export type WithDbEnv = {
  Bindings: Env;
  Variables: WithDbVariables;
};

/**
 * Reads `c.env.DB` (a Drizzle handle constructed at host wrap time) and
 * publishes it as `c.var.db` for the rest of the request chain.
 *
 * Throws synchronously if the binding is absent — every host that
 * mounts this middleware MUST inject `DB`. Failing loud at the first
 * request is preferable to a downstream `TypeError: undefined is not a
 * function` that masquerades as a route bug.
 */
export function withDb(): MiddlewareHandler<WithDbEnv> {
  return async (c, next) => {
    const handle = c.env.DB;
    if (handle === undefined || handle === null) {
      throw new Error(
        'withDb: c.env.DB is not bound. The host (Node dev server or Worker entrypoint) must construct a Drizzle handle and pass it via the DB binding.',
      );
    }
    c.set('db', handle);
    await next();
  };
}
