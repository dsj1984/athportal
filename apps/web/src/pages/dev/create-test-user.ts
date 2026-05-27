// apps/web/src/pages/dev/create-test-user.ts
//
// Dev-only Clerk Test-instance user creation seam, the companion to
// `/dev/sign-in-as/:persona` (Story #940). Story #953 / F4.
//
// POST /dev/create-test-user with a JSON body:
//   {
//     "email":         "signup+clerk_test@example.com",  // required
//     "password":      "OverridePassw0rd!2026",          // optional
//     "emailVerified": true,                              // optional, default true
//     "firstName":     "Ada",                             // optional
//     "lastName":      "Lovelace"                         // optional
//   }
//
// Returns JSON:
//   {
//     "userId":         "user_test_…",
//     "email":          "signup+clerk_test@example.com",
//     "emailVerified":  true,
//     "password":       "…",                              // echoed for caller's records
//     "signInTicket":   "sit_…"                           // one-shot, 60s TTL
//   }
//
// The companion to `mintSignInTicket()` for *existing* personas, this
// route exists so manual sweep sessions on Story #945 Session 2 (and
// the future agent runner) can provision fresh users without going
// through the Cloudflare Turnstile-protected `/sign-up` form.
//
// We cannot import from `packages/shared/src/testing/**` because
// dep-cruiser's `test-helpers-only-in-tests` rule forbids
// `apps/web/src/**` from doing so — see the analogous comment in
// `apps/web/src/pages/dev/sign-in-as/[persona].ts`. Instead this file
// inlines the same load-bearing pieces (sk_test_ guard, REST POSTs)
// so the dep-cruiser graph stays clean.
//
// Safety boundary:
//   1. Hard-refuses in production via `import.meta.env.PROD` and an
//      explicit `RUNTIME_ENV !== 'development'` check.
//   2. Refuses unless `CLERK_SECRET_KEY` starts with `sk_test_`.
//   3. Validates the request body shape at the edge.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { APIRoute } from 'astro';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../../../..');
const ROOT_ENV_PATH = resolve(REPO_ROOT, '.env');

const TICKET_TTL_SECONDS = 60;
const CLERK_TEST_EMAIL_PATTERN = /\+clerk_test@/i;

interface CreateBody {
  email: string;
  password?: string;
  emailVerified?: boolean;
  firstName?: string;
  lastName?: string;
}

// Astro's Vite dev server does not populate `process.env` with the
// keys declared in the root `.env`. Mirror the lazy loader used by
// `/dev/sign-in-as/:persona` so this dev-only route can read
// `CLERK_SECRET_KEY` regardless of how the dev server was launched.
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

function notFound(): Response {
  return new Response('Not Found', { status: 404 });
}

function badRequest(message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 400,
    headers: { 'content-type': 'application/json' },
  });
}

function parseBody(raw: unknown): CreateBody | null {
  if (raw === null || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.email !== 'string' || o.email.length === 0) return null;
  if (o.password !== undefined && typeof o.password !== 'string') return null;
  if (o.emailVerified !== undefined && typeof o.emailVerified !== 'boolean') return null;
  if (o.firstName !== undefined && typeof o.firstName !== 'string') return null;
  if (o.lastName !== undefined && typeof o.lastName !== 'string') return null;
  return {
    email: o.email,
    ...(typeof o.password === 'string' ? { password: o.password } : {}),
    ...(typeof o.emailVerified === 'boolean' ? { emailVerified: o.emailVerified } : {}),
    ...(typeof o.firstName === 'string' ? { firstName: o.firstName } : {}),
    ...(typeof o.lastName === 'string' ? { lastName: o.lastName } : {}),
  };
}

async function clerkPost(
  path: string,
  secretKey: string,
  body: Record<string, unknown>,
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; status: number; body: string }> {
  const res = await fetch(`https://api.clerk.com${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${secretKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { ok: false, status: res.status, body: text.slice(0, 500) };
  }
  return { ok: true, data: (await res.json()) as Record<string, unknown> };
}

const DEFAULT_TEST_PASSWORD = 'TestUser!Passw0rd-2026';

export const POST: APIRoute = async ({ request }) => {
  if (isProduction()) return notFound();

  loadRootEnv();
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey || !secretKey.startsWith('sk_test_')) {
    return new Response(
      'dev create-test-user seam refused: CLERK_SECRET_KEY must start with sk_test_. ' +
        'See docs/runbooks/clerk-persona-bootstrap.md.',
      { status: 500 },
    );
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return badRequest('Request body must be valid JSON.');
  }
  const body = parseBody(rawBody);
  if (body === null) {
    return badRequest(
      "Request body must be { email: string, password?: string, " +
        'emailVerified?: boolean, firstName?: string, lastName?: string }.',
    );
  }

  const password = body.password ?? DEFAULT_TEST_PASSWORD;
  const emailVerified = body.emailVerified ?? true;

  if (!CLERK_TEST_EMAIL_PATTERN.test(body.email)) {
    console.warn(
      `/dev/create-test-user: email does not match Clerk's '+clerk_test@' ` +
        `testing-channel pattern. Verification codes for non-test addresses ` +
        `cannot be retrieved without a real inbox.`,
    );
  }

  // Step 1 — create the user. Two paths:
  //   verified=true:  POST /v1/users with email_address[] populated; Clerk auto-verifies.
  //   verified=false: POST /v1/users with no email; then POST /v1/email_addresses with verified:false.
  const createUserPayload: Record<string, unknown> = {
    password,
    skip_password_checks: true,
    ...(body.firstName ? { first_name: body.firstName } : {}),
    ...(body.lastName ? { last_name: body.lastName } : {}),
  };
  if (emailVerified) {
    createUserPayload.email_address = [body.email];
  }
  const createUser = await clerkPost('/v1/users', secretKey, createUserPayload);
  if (!createUser.ok) {
    return new Response(
      JSON.stringify({
        error: 'Clerk users.create failed',
        status: createUser.status,
        body: createUser.body,
      }),
      { status: 502, headers: { 'content-type': 'application/json' } },
    );
  }
  const userId = createUser.data.id;
  if (typeof userId !== 'string') {
    return new Response(
      JSON.stringify({ error: 'Clerk users.create returned no id.' }),
      { status: 502, headers: { 'content-type': 'application/json' } },
    );
  }

  if (!emailVerified) {
    const addEmail = await clerkPost('/v1/email_addresses', secretKey, {
      user_id: userId,
      email_address: body.email,
      verified: false,
      primary: true,
    });
    if (!addEmail.ok) {
      return new Response(
        JSON.stringify({
          error: 'Clerk email_addresses.create failed',
          status: addEmail.status,
          body: addEmail.body,
        }),
        { status: 502, headers: { 'content-type': 'application/json' } },
      );
    }
  }

  // Step 2 — mint a sign-in ticket so the caller can immediately
  // exchange it for a session via Clerk's frontend ticket flow.
  const ticketRes = await clerkPost('/v1/sign_in_tokens', secretKey, {
    user_id: userId,
    expires_in_seconds: TICKET_TTL_SECONDS,
  });
  if (!ticketRes.ok) {
    return new Response(
      JSON.stringify({
        error: 'Clerk sign_in_tokens.create failed',
        status: ticketRes.status,
        body: ticketRes.body,
      }),
      { status: 502, headers: { 'content-type': 'application/json' } },
    );
  }
  const ticket = ticketRes.data.token;

  return new Response(
    JSON.stringify({
      userId,
      email: body.email,
      emailVerified,
      password,
      signInTicket: typeof ticket === 'string' ? ticket : null,
    }),
    { status: 201, headers: { 'content-type': 'application/json' } },
  );
};
