// apps/api/src/routes/v1/sign-out.ts
//
// POST /api/v1/sign-out — server-side hook for the Astro `signOut()`
// flow documented in Tech Spec #318 §B. Clears the `__session` cookie
// and emits an audit log line carrying the Clerk subject id (NOT the
// email — that field is redacted in the request-completion logger per
// security-baseline §"Data Leakage & Logging").
//
// Auth: `member`+. Mounted under the `requireInternalUser` chain so
// `c.var.auth` is populated before the handler runs.
//
// Response: 204 No Content with a `Set-Cookie: __session=…` header
// that expires the cookie. Per Tech Spec #318 §Security the cleared
// cookie carries the same security flags Clerk uses when issuing it
// (HttpOnly + Secure + SameSite=Lax) so a downgraded re-issue is
// impossible.

import { Hono } from 'hono';
import type { RequireInternalUserEnv } from '../../middleware/auth';

export const signOutRoute = new Hono<RequireInternalUserEnv>();

/**
 * Cookie attributes used to delete the `__session` cookie. The browser
 * matches on (Name, Domain, Path) — security flags do not affect the
 * match but we still set them to keep the deletion request properly
 * formatted and to mirror Clerk's issuance flags.
 */
const SESSION_COOKIE_NAME = '__session';
const CLEAR_COOKIE_VALUE = [
  `${SESSION_COOKIE_NAME}=`,
  'Path=/',
  'Max-Age=0',
  'HttpOnly',
  'Secure',
  'SameSite=Lax',
].join('; ');

signOutRoute.post('/', (c) => {
  const auth = c.get('auth');

  // Audit log line. The request-completion logger (Story #257) records
  // the response; we add an explicit event so the operator can grep
  // for sign-outs by Clerk subject. PII (email) is intentionally
  // omitted — the subject id is opaque and not PII.
  // biome-ignore lint/suspicious/noConsole: audit event, scrubbed by redactor.
  console.info(
    JSON.stringify({
      event: 'auth.sign_out',
      clerkSubjectId: auth.clerkSubjectId,
      userId: auth.userId,
    }),
  );

  c.header('Set-Cookie', CLEAR_COOKIE_VALUE);
  return c.body(null, 204);
});
