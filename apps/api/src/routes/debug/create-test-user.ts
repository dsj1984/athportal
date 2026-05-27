// apps/api/src/routes/debug/create-test-user.ts
//
// Gated dev-only endpoint that wraps `createTestUser()` + `signInTokens.createSignInToken`
// for the acceptance-tier fresh-user seam. Story #963 (F4 follow-up to #958).
//
// The acceptance suite needs to drive `/onboarding` as a brand-new user
// — the persona-graph seed users are pre-onboarded and cannot exercise
// the un-onboarded branch. This route exposes the shared
// `createTestUser` helper over HTTP so a Playwright fixture can mint a
// fresh `+clerk_test@` user, exchange the returned sign-in ticket, and
// drive the form as that user.
//
// Three invariants the contract test (`./create-test-user.contract.test.ts`)
// locks down:
//
//   1. **Gate closed → every verb returns 404** with the standard error
//      envelope. No 403, no 405. Disclosure of the route's existence
//      via 405 would defeat the "indistinguishable from a non-existent
//      route" contract — same as `synthetic-failure.ts`.
//      The gate is `DEBUG_TEST_USER_CREATION_ENABLED === 'true'`.
//
//   2. **Gate open + POST → mint user + sign-in ticket**. Body is
//      validated by Zod; missing required fields → 400 with a Zod-
//      shaped error envelope. Non-`+clerk_test@` emails → 400 (refused
//      defensively — the shared helper warns rather than refuses, but
//      the route is the user-facing boundary and we don't want the
//      e2e to silently mint addresses that can't retrieve verification
//      codes).
//
//   3. **`sk_test_` enforcement**. The shared helper's secret-key
//      validator throws if `CLERK_SECRET_KEY` is missing or carries a
//      non-test prefix. This route translates that throw into a 503
//      `MISCONFIGURED_INSTANCE` envelope so callers see a useful
//      operator-facing message rather than a stack trace.
//
// Security boundary (`risk::high`):
//
//   - The gate **defaults closed**. Production builds never set
//     `DEBUG_TEST_USER_CREATION_ENABLED`; only the local dev server
//     (via `apps/api/src/local.ts`) and the CI test-job env do.
//   - The `sk_test_` enforcement lives in
//     `assertClerkTestSecretKey` (shared helper). Even if the gate is
//     accidentally flipped on against a production Clerk instance,
//     the helper refuses to mint users — the boundary is bytecode-deep.
//   - The sign-in ticket TTL is clamped to 30s (the existing
//     `DEFAULT_SIGN_IN_TICKET_TTL_SECONDS` constant) to limit blast
//     radius if the response is ever logged.
//   - The response body returns the freshly minted password verbatim
//     so the Playwright fixture can drive a password-form sign-in as
//     a fallback. The response is never persisted — the Playwright
//     fixture reads it once and discards it.

import { createClerkClient } from '@clerk/backend';
import { Hono } from 'hono';
import { z } from 'zod';

import {
  type CreatedTestUser,
  assertClerkTestSecretKey,
  createTestUser,
  isClerkTestChannelEmail,
} from '@repo/shared/testing';

/**
 * Environment bindings this route reads.
 *
 *   - `DEBUG_TEST_USER_CREATION_ENABLED`: the gate. Compared to the
 *     literal string `'true'`. Anything else (unset, `'false'`, `'1'`,
 *     `'TRUE'`) is the closed state.
 *   - `CLERK_SECRET_KEY`: the test-instance secret key, forwarded to
 *     `createTestUser` and `signInTokens.createSignInToken`. The
 *     `sk_test_` boundary is enforced by the shared helper before any
 *     Clerk call goes out.
 */
export interface CreateTestUserDebugEnv {
  DEBUG_TEST_USER_CREATION_ENABLED?: string;
  CLERK_SECRET_KEY?: string;
}

/**
 * Sign-in ticket TTL. Matches `DEFAULT_SIGN_IN_TICKET_TTL_SECONDS` from
 * the shared `clerkTickets` module — 30 seconds is long enough for the
 * Playwright fixture to navigate and exchange, short enough to limit
 * blast radius if the response is logged.
 */
const SIGN_IN_TICKET_TTL_SECONDS = 30;

/**
 * Body schema. Mirrors `CreateTestUserOptions` from the shared helper
 * but trims to the fields a Playwright fixture actually needs:
 *
 *   - `email` is required and MUST match Clerk's `+clerk_test@`
 *     test-channel pattern. The shared helper warns on misuse; the
 *     route refuses, because a non-test email can never complete the
 *     ticket-exchange flow (the verification code lookup wedges
 *     forever).
 *   - `emailVerified` defaults to `true` so the standard happy-path
 *     fixture does not need to spell it out.
 *   - `firstName` / `lastName` are optional metadata. Most fresh-user
 *     scenarios fill them in via the onboarding form, so the helper
 *     leaves them omitted by default.
 */
const RequestBody = z.object({
  email: z
    .string()
    .min(1)
    .email()
    .refine(isClerkTestChannelEmail, {
      message:
        "email must use Clerk's test channel ('local+clerk_test@example.com'). " +
        'Non-test-channel emails cannot retrieve verification codes.',
    }),
  emailVerified: z.boolean().optional().default(true),
  firstName: z.string().min(1).max(80).optional(),
  lastName: z.string().min(1).max(80).optional(),
});

const NOT_FOUND_BODY = {
  success: false,
  error: { code: 'NOT_FOUND', message: 'Not Found' },
} as const;

const MISCONFIGURED_BODY = {
  success: false,
  error: {
    code: 'MISCONFIGURED_INSTANCE',
    message:
      'The /api/v1/_debug/create-test-user route refused: CLERK_SECRET_KEY is ' +
      "missing or does not carry the 'sk_test_' prefix this seam requires. " +
      'Check the dev server env file.',
  },
} as const;

/**
 * Hono sub-app mounted at `/api/v1/_debug/create-test-user` by
 * `apps/api/src/index.ts`. Mirrors the route shape of
 * `synthetic-failure.ts`:
 *
 *   - POST: gate check, validate body, mint user + ticket.
 *   - `.all`: 404 catch-all so verb mismatch is indistinguishable from
 *     a non-existent route.
 */
export const createTestUserDebugRoute = new Hono<{ Bindings: CreateTestUserDebugEnv }>();

createTestUserDebugRoute.post('/', async (c) => {
  const gate = c.env?.DEBUG_TEST_USER_CREATION_ENABLED;
  if (gate !== 'true') {
    return c.json(NOT_FOUND_BODY, 404);
  }

  // Body validation. A malformed payload at a dev-only route is
  // operator error — we return a 400 with the Zod-shaped error envelope
  // so the failure is obvious in the Playwright fixture's response log.
  const rawBody = (await c.req.json().catch(() => null)) as unknown;
  const parsed = RequestBody.safeParse(rawBody);
  if (!parsed.success) {
    return c.json(
      {
        success: false,
        error: {
          code: 'INVALID_BODY',
          message: 'Request body failed schema validation.',
          details: parsed.error.issues.map((issue) => ({
            path: issue.path.map(String),
            message: issue.message,
          })),
        },
      },
      400,
    );
  }

  const secretKey = c.env?.CLERK_SECRET_KEY;

  // Bytecode-deep `sk_test_` enforcement. We pre-check here so we can
  // translate the throw into a stable 503 envelope rather than a 5xx
  // stack trace; the helper itself re-throws the same check inside
  // `createTestUser`, which is fine — it is defensive belt+braces.
  try {
    assertClerkTestSecretKey(secretKey);
  } catch {
    return c.json(MISCONFIGURED_BODY, 503);
  }

  let created: CreatedTestUser;
  try {
    created = await createTestUser({
      email: parsed.data.email,
      emailVerified: parsed.data.emailVerified,
      ...(parsed.data.firstName ? { firstName: parsed.data.firstName } : {}),
      ...(parsed.data.lastName ? { lastName: parsed.data.lastName } : {}),
      secretKey,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    return c.json(
      {
        success: false,
        error: { code: 'CREATE_FAILED', message },
      },
      502,
    );
  }

  // Mint the sign-in ticket. Re-uses the same Clerk client + secret
  // boundary the helper used; we re-instantiate rather than threading
  // the client out so the helper's internal `clerkFactory` injection
  // seam (used by unit tests) stays the only place the SDK is
  // constructed for user creation. The cost is one extra (cheap) SDK
  // construction; the benefit is no API leak from the helper.
  let signInTicket: { token: string; userId: string; expiresInSeconds: number };
  try {
    const client = createClerkClient({ secretKey });
    const minted = await client.signInTokens.createSignInToken({
      userId: created.userId,
      expiresInSeconds: SIGN_IN_TICKET_TTL_SECONDS,
    });
    signInTicket = {
      token: minted.token,
      userId: minted.userId,
      expiresInSeconds: SIGN_IN_TICKET_TTL_SECONDS,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    return c.json(
      {
        success: false,
        error: { code: 'TICKET_MINT_FAILED', message },
      },
      502,
    );
  }

  return c.json(
    {
      success: true,
      data: {
        userId: created.userId,
        email: created.email,
        emailVerified: created.emailVerified,
        password: created.password,
        signInTicket: signInTicket.token,
        signInTicketExpiresInSeconds: signInTicket.expiresInSeconds,
      },
    },
    200,
  );
});

// Catch-all 404 so verb mismatch is indistinguishable from a
// non-existent path (mirrors `synthetic-failure.ts`).
createTestUserDebugRoute.all('/', (c) => c.json(NOT_FOUND_BODY, 404));
