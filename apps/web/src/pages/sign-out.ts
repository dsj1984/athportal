// apps/web/src/pages/sign-out.ts
//
// Server-side sign-out endpoint. POST revokes the active Clerk session
// server-side and clears every Clerk-namespaced cookie the middleware
// reads on subsequent requests. GET is rejected with 405 so the route
// stays POST-only — sign-out is a state-changing action and must not be
// CSRF-vulnerable via a stray link or image tag.
//
// Story #951 — earlier shape (Task #333) deleted only the literal
// `__session` cookie and redirected to `/`. Both were wrong:
//
//   1. Clerk dev-mode namespaces every cookie with a per-instance
//      suffix (`__session_<inst>`, `__clerk_db_jwt_<inst>`,
//      `__client_uat_<inst>`, plus the stable `clerk_active_context`).
//      Deleting only `__session` left every namespaced cookie alive,
//      so the next protected-route request re-authenticated from them
//      and the user-visible posture was: "/sign-out does not sign you
//      out for the JWT TTL (~5 min)." See sweep notes on Story #945
//      Session 1 (`tp-identity-signout` FAIL at Step 5).
//   2. The 303 target was `/`, which is a 404 route. Same anti-pattern
//      PR #940 fixed for `<SignIn forceRedirectUrl="/dashboard">`.
//
// The fix parses the request's `Cookie` header, finds every cookie
// matching the Clerk namespaces, and emits a `Set-Cookie` delete for
// each — at the same `path: '/'` scope Clerk set them with — so the
// browser drops them all atomically before the redirect lands.
//
// Server-side `clerkClient.sessions.revokeSession()` is still
// best-effort defense-in-depth (the cookie clear is the user-visible
// contract), but failures now emit a structured `warn` log so an
// operator can see why a revoke didn't happen.

import { clerkClient } from '@clerk/astro/server';

/**
 * Cookies the sign-out endpoint must delete. Two shapes:
 *
 *   - **Namespaced** (`__session`, `__clerk_db_jwt`, `__client_uat`)
 *     — Clerk dev/test instances suffix these with a per-instance
 *     identifier (e.g. `__session_0NWIer_-`). The bare literal also
 *     appears in some setups (legacy / production). Match both.
 *   - **Stable** (`clerk_active_context`) — no suffix. Stays a literal.
 *
 * The regex anchors at start and end so we never match a cookie whose
 * name merely contains one of these tokens.
 */
const CLERK_COOKIE_PATTERNS: readonly RegExp[] = [
  /^__session(_[A-Za-z0-9_-]+)?$/,
  /^__clerk_db_jwt(_[A-Za-z0-9_-]+)?$/,
  /^__client_uat(_[A-Za-z0-9_-]+)?$/,
  /^clerk_active_context$/,
];

const SIGN_IN_REDIRECT = '/sign-in';

/**
 * Minimal structural type of the per-request context Astro hands every
 * endpoint. Apps/web does not yet declare `astro` as a workspace dep —
 * the runtime is pulled in transitively via `@clerk/astro` — so this
 * endpoint types the surface it actually consumes (locals, cookies,
 * redirect, request) rather than reach for
 * `import type { APIContext } from 'astro'`.
 */
type SignOutContext = Parameters<typeof clerkClient>[0] & {
  locals: App.Locals;
  cookies: {
    delete(name: string, options?: { path?: string }): void;
  };
  redirect(path: string, status?: number): Response;
  request: Request;
};

/**
 * Extract the set of cookie names present on the request that match
 * any of the Clerk patterns. Exported for the contract test so the
 * test and the endpoint share the same match logic.
 */
export function extractClerkCookieNames(cookieHeader: string | null): string[] {
  if (!cookieHeader) return [];
  const names: string[] = [];
  for (const raw of cookieHeader.split(';')) {
    const trimmed = raw.trim();
    if (trimmed === '') continue;
    const eq = trimmed.indexOf('=');
    const name = eq === -1 ? trimmed : trimmed.slice(0, eq);
    if (CLERK_COOKIE_PATTERNS.some((pattern) => pattern.test(name))) {
      // Deduplicate — the browser shouldn't send the same cookie twice
      // but the spec doesn't forbid it, and we don't want to emit the
      // same Set-Cookie delete twice either.
      if (!names.includes(name)) names.push(name);
    }
  }
  return names;
}

export const POST = async (context: SignOutContext): Promise<Response> => {
  const auth = context.locals.auth();
  const sessionId = auth.sessionId;

  if (sessionId) {
    // Revoke server-side so the JWT cannot be re-presented. Failure
    // here (already-revoked, transient Clerk 5xx) must not block the
    // cookie clear and redirect — that is the user-visible contract.
    try {
      await clerkClient(context).sessions.revokeSession(sessionId);
    } catch (err) {
      const errorClass = err instanceof Error ? err.constructor.name : typeof err;
      // Structured payload only. No session id, no user id, no token —
      // those are session-correlatable PII per the security baseline.
      console.warn(JSON.stringify({ event: 'sign_out_revoke_failed', errorClass }));
    }
  }

  // Delete every Clerk-namespaced cookie present on the request. Path
  // matches the `/` scope Clerk uses when it sets them.
  const cookieNames = extractClerkCookieNames(context.request.headers.get('cookie'));
  for (const name of cookieNames) {
    context.cookies.delete(name, { path: '/' });
  }

  return context.redirect(SIGN_IN_REDIRECT, 303);
};

export const GET = (): Response =>
  new Response('Method Not Allowed', {
    status: 405,
    headers: { Allow: 'POST' },
  });
