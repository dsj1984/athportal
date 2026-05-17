/**
 * @repo/shared/testing/auth — `authHeaders(user)` for contract tests.
 *
 * Per docs/architecture.md §1, the auth provider is Clerk
 * (`@clerk/astro` at MVP, `@clerk/clerk-expo` at v1.0). The
 * `clerkAuth` + `requireInternalUser` middleware pair lives at
 * `apps/api/src/middleware/auth.ts` (not yet landed at the time this
 * harness was authored).
 *
 * Until the middleware lands, this helper returns the documented
 * test-time contract: an `Authorization: Bearer <token>` header plus a
 * synthetic `x-clerk-user-id` header that the middleware can read in
 * test mode to bypass live Clerk verification. The header bag is a
 * plain `Record<string, string>` so it composes directly with Fetch
 * `RequestInit.headers` and Hono's `app.request(path, init)`.
 *
 * Story #172 / Task #181.
 */

import type { User } from './schema';

/**
 * Minimum shape `authHeaders` needs from a user record. Accepts any
 * object exposing `clerkId` (a full `User` from the schema works, as does
 * a hand-built test stub).
 */
export interface AuthUserLike {
  readonly clerkId: string;
  readonly id?: string;
  readonly email?: string;
}

/**
 * Build the header bag that satisfies Clerk's `clerkAuth` middleware in
 * test mode. The token is a deterministic synthetic value derived from
 * the user's clerkId so debugging output is readable.
 */
export function authHeaders(user: AuthUserLike): Record<string, string> {
  if (!user.clerkId || typeof user.clerkId !== 'string') {
    throw new TypeError('authHeaders: user.clerkId must be a non-empty string');
  }
  return {
    Authorization: `Bearer test-clerk-token-${user.clerkId}`,
    'x-clerk-user-id': user.clerkId,
    'content-type': 'application/json',
  };
}

/** Re-export the `User` row type so consumers can write `authHeaders(user as User)` succinctly. */
export type { User };
