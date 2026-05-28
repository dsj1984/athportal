// apps/web/src/pages/dev/sign-in-as/[persona].ts
//
// Dev-only sign-in seam for the three QA personas (athlete, coach,
// org-admin). Visiting `/dev/sign-in-as/coach` mints a one-shot Clerk
// sign-in ticket for the coach persona and redirects through Clerk's
// frontend ticket flow, landing on `/dashboard`. Removes the need for
// the operator (or me, walking through a manual test plan) to know
// the persona passwords — Clerk subject IDs in `clerk-personas.json`
// are the single source of truth.
//
// This is the manual-QA counterpart to the QA-corpus agent runner's
// `mintSignInTicket()` flow (packages/shared/src/testing/clerkTickets.ts).
// We cannot import that helper from here because dep-cruiser's
// `test-helpers-only-in-tests` rule forbids `apps/web/src/**` from
// reaching into `packages/shared/src/testing/**` — the test seam must
// not ship in production bundles. Instead, this file inlines the same
// load-bearing pieces (sk_test_ guard, JSON read, Clerk REST POST) so
// the dep-cruiser graph stays clean.
//
// Safety boundary:
//   1. Hard-refuses in production via `import.meta.env.PROD` and an
//      explicit `RUNTIME_ENV !== 'development'` check.
//   2. Refuses unless `CLERK_SECRET_KEY` starts with `sk_test_` —
//      mirrors the same guard in `mintSignInTicket()`.
//   3. Only mints tickets for the three canonical QA personas;
//      arbitrary `userId` values cannot be passed in.
//   4. Story #988 — refuses with `409 Conflict` when `locals.auth()`
//      reports an existing Clerk session whose `userId` does not match
//      the target persona. Clerk's frontend short-circuits ticket
//      exchange when a session is already present, which would
//      otherwise leave the operator silently signed in as the previous
//      persona; the 409 surfaces that case explicitly with a sign-out
//      form-shim so the workflow is obvious instead of being a
//      ten-minute debug session.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { APIRoute } from 'astro';

const QA_PERSONAS = ['athlete', 'coach', 'org-admin'] as const;
type QaPersona = (typeof QA_PERSONAS)[number];

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../../../../..');
const PERSONAS_JSON_PATH = resolve(REPO_ROOT, 'packages/shared/src/testing/clerk-personas.json');
const ROOT_ENV_PATH = resolve(REPO_ROOT, '.env');

const TICKET_TTL_SECONDS = 60;

// Astro's Vite dev server does not populate `process.env` with the
// keys declared in the root `.env` — `import.meta.env` only exposes
// `PUBLIC_*` vars. Mirror the lazy loader from apps/api/src/local.ts
// so this dev-only route can read CLERK_SECRET_KEY regardless of how
// the dev server was launched. Idempotent; only fills keys that are
// genuinely unset.
function loadRootEnv(): void {
  if (!existsSync(ROOT_ENV_PATH)) return;
  const text = readFileSync(ROOT_ENV_PATH, 'utf8');
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function isProduction(): boolean {
  if (import.meta.env.PROD) return true;
  return (process.env.RUNTIME_ENV ?? 'development') === 'production';
}

function isQaPersona(value: string): value is QaPersona {
  return (QA_PERSONAS as readonly string[]).includes(value);
}

function notFound(): Response {
  return new Response('Not Found', { status: 404 });
}

/**
 * Build the `409 Conflict` HTML body returned when the caller already has
 * a Clerk session for a different persona. Exported so the unit test can
 * assert the body shape; rendering happens inside the GET handler.
 *
 * Pure function — no I/O, no environment access — so it can be exercised
 * directly without an Astro context.
 */
export function renderExistingSessionConflict(args: {
  readonly targetPersona: string;
  readonly currentUserId: string;
}): { readonly body: string; readonly status: 409 } {
  const target = args.targetPersona;
  const current = args.currentUserId;
  const retryHref = `/dev/sign-in-as/${encodeURIComponent(target)}`;
  return {
    status: 409,
    body: `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Already signed in — dev sign-in seam</title></head>
<body>
<h1>Already signed in</h1>
<p>This dev seam cannot mint a sign-in ticket for <code>${target}</code> while another Clerk session (<code>${current}</code>) is active. Clerk's frontend short-circuits ticket exchange when a session is already present, which would silently leave you signed in as the previous persona.</p>
<p>Sign out first using the form below, then retry the request.</p>
<form method="POST" action="/sign-out"><button type="submit">Sign out</button></form>
<p>After signing out, visit <a href="${retryHref}">${retryHref}</a> to mint the ticket for <code>${target}</code>.</p>
<p>See <a href="/docs/runbooks/clerk-persona-bootstrap.md">docs/runbooks/clerk-persona-bootstrap.md</a> for the QA workflow.</p>
</body>
</html>`,
  };
}

export const GET: APIRoute = async ({ params, locals, redirect }) => {
  if (isProduction()) return notFound();

  const persona = params.persona;
  if (typeof persona !== 'string' || !isQaPersona(persona)) return notFound();

  loadRootEnv();
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey || !secretKey.startsWith('sk_test_')) {
    return new Response(
      'dev sign-in seam refused: CLERK_SECRET_KEY must start with sk_test_. ' +
        'See docs/runbooks/clerk-persona-bootstrap.md.',
      { status: 500 },
    );
  }

  const personaIds = JSON.parse(readFileSync(PERSONAS_JSON_PATH, 'utf8')) as Record<
    string,
    string | null
  >;
  const userId = personaIds[persona];
  if (typeof userId !== 'string' || userId.length === 0) {
    return new Response(
      `dev sign-in seam: clerk-personas.json has no subject ID for persona "${persona}". ` +
        'Bootstrap the persona per docs/runbooks/clerk-persona-bootstrap.md.',
      { status: 500 },
    );
  }

  // Story #988 — refuse cleanly when an existing Clerk session is present
  // for a different user. Clerk's frontend silently no-ops the ticket
  // exchange in that case, so we surface a 409 with a form-shim sign-out.
  // The Clerk middleware (see apps/web/src/middleware.ts) populates
  // `locals.auth()` for every request; on dev surfaces it returns `null`
  // for anonymous callers and a `userId` string for signed-in callers.
  const authLocal = (locals as { auth?: () => { userId: string | null } }).auth;
  const currentUserId = typeof authLocal === 'function' ? authLocal().userId : null;
  if (typeof currentUserId === 'string' && currentUserId.length > 0 && currentUserId !== userId) {
    const conflict = renderExistingSessionConflict({
      targetPersona: persona,
      currentUserId,
    });
    return new Response(conflict.body, {
      status: conflict.status,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  }

  const tokenRes = await fetch('https://api.clerk.com/v1/sign_in_tokens', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${secretKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ user_id: userId, expires_in_seconds: TICKET_TTL_SECONDS }),
  });
  if (!tokenRes.ok) {
    const body = await tokenRes.text().catch(() => '');
    return new Response(
      `dev sign-in seam: Clerk sign_in_tokens returned ${String(tokenRes.status)}. Body: ${body.slice(0, 300)}`,
      { status: 502 },
    );
  }
  const payload = (await tokenRes.json()) as { token?: string };
  if (typeof payload.token !== 'string' || payload.token.length === 0) {
    return new Response('dev sign-in seam: Clerk did not return a ticket.', { status: 502 });
  }

  // Clerk's frontend exchanges the ticket via `__clerk_ticket=…` on the
  // sign-in page. `redirect_url` carries us to the dashboard after the
  // exchange completes — bypasses the bare `/` route that does not exist.
  const target = `/sign-in?__clerk_ticket=${encodeURIComponent(payload.token)}&redirect_url=${encodeURIComponent('/dashboard')}`;
  return redirect(target, 302);
};
