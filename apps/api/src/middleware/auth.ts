// apps/api/src/middleware/auth.ts
//
// Production auth middleware for @repo/api.
//
// Listed in docs/architecture.md §5 as security-critical. Owned by
// Epic #7. The exported `clerkAuth` middleware runs first on every
// request (`app.use('*', clerkAuth())`) and validates the Clerk session
// token carried in either the `__session` cookie (browser flow) or an
// `Authorization: Bearer …` header (server-to-server flow). On success
// it writes the Clerk subject id (`sub` claim) into `c.var.clerkSubjectId`
// and yields to the next handler. On failure it returns 401 with the
// canonical error envelope:
//
//   { success: false, error: { code: 'UNAUTHENTICATED', message } }
//
// Stack traces and internal error details are NEVER echoed to the caller
// — per `.agents/rules/security-baseline.md` (Output & Rendering, Data
// Leakage & Logging) and Tech Spec #318 §Security.
//
// The companion `requireInternalUser` middleware (Task #343, same file)
// runs second under `app.use('/api/v1/*', requireInternalUser)` and is
// responsible for the JIT users-row lookup/insert.

import { verifyToken } from '@clerk/backend';
import type { MiddlewareHandler } from 'hono';
import type { Env } from '../env';

/**
 * Hono variable surface contributed by `clerkAuth`. The middleware only
 * promises `clerkSubjectId`; `requireInternalUser` extends the
 * `c.var.auth` shape downstream with the resolved internal user.
 */
export interface ClerkAuthVariables {
  clerkSubjectId: string;
}

export type ClerkAuthEnv = {
  Bindings: Env;
  Variables: ClerkAuthVariables;
};

/**
 * Canonical auth-error code surface. Kept narrow on purpose — the
 * RBAC-layer codes (`FORBIDDEN`, `LAST_ADMIN`, …) live in their own
 * routes. `UNAUTHENTICATED` is the only code this middleware emits.
 */
export type AuthErrorCode = 'UNAUTHENTICATED';

interface AuthErrorBody {
  readonly success: false;
  readonly error: {
    readonly code: AuthErrorCode;
    readonly message: string;
  };
}

function unauthenticated(message: string): AuthErrorBody {
  return {
    success: false,
    error: { code: 'UNAUTHENTICATED', message },
  };
}

/**
 * Best-effort cookie parser scoped to a single cookie name. We avoid a
 * full RFC 6265 dependency here — the cookie header for our routes is
 * always produced by Clerk, so the format is constrained.
 */
function readSessionCookie(header: string | null | undefined): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith('__session=')) {
      const value = trimmed.slice('__session='.length);
      return value.length > 0 ? value : null;
    }
  }
  return null;
}

function readBearerToken(header: string | null | undefined): string | null {
  if (!header) return null;
  if (!header.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

/**
 * Resolve the Clerk session token from a request. Cookie takes precedence
 * over Authorization: server-rendered browser flows always carry the
 * `__session` cookie; the bearer fallback exists for server-to-server
 * callers that present a Clerk-minted token directly.
 */
function extractToken(req: Request): string | null {
  return (
    readSessionCookie(req.headers.get('cookie')) ?? readBearerToken(req.headers.get('authorization'))
  );
}

/**
 * `clerkAuth` middleware factory. Returns a Hono middleware that:
 *
 *   1. Extracts the Clerk session token from the request.
 *   2. Validates it against the Clerk Backend API using the Worker's
 *      `CLERK_SECRET_KEY` binding.
 *   3. On success, writes the Clerk subject id (`sub`) into
 *      `c.var.clerkSubjectId` and calls `next()`.
 *   4. On any failure, returns `401 UNAUTHENTICATED` with the canonical
 *      error envelope — no stack trace, no internal class name.
 *
 * Concrete failure paths mapped to the same envelope:
 *
 *   - Missing token (no cookie, no bearer)
 *   - Token rejected by `verifyToken` (expired, wrong signature,
 *     unknown subject, malformed payload, etc.)
 *   - Token verifies but the payload has no `sub` claim — defensive
 *     guard, should be unreachable with Clerk-issued tokens.
 */
export function clerkAuth(): MiddlewareHandler<ClerkAuthEnv> {
  return async (c, next) => {
    const token = extractToken(c.req.raw);
    if (!token) {
      return c.json(unauthenticated('Authentication required.'), 401);
    }

    const secretKey = c.env.CLERK_SECRET_KEY;
    if (!secretKey) {
      // Misconfiguration — the binding is required at deploy time. We
      // still surface 401 (never echo internal config state to the
      // caller) but the binding's absence will already have failed the
      // deploy precheck.
      return c.json(unauthenticated('Authentication required.'), 401);
    }

    const verification = await verifyToken(token, { secretKey });
    if (verification.errors !== undefined) {
      return c.json(unauthenticated('Authentication required.'), 401);
    }

    const payload = verification.data as { sub?: unknown };
    const subject = typeof payload.sub === 'string' ? payload.sub : '';
    if (subject.length === 0) {
      return c.json(unauthenticated('Authentication required.'), 401);
    }

    c.set('clerkSubjectId', subject);
    await next();
    return undefined;
  };
}
