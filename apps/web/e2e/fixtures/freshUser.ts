/**
 * Fresh-user Playwright seam (Story #963).
 *
 * Mints a brand-new `+clerk_test@` user via the dev-only
 * `POST /api/v1/_debug/create-test-user` route, then drives Clerk's
 * test helper to sign that user into the browser. The returned `Page`
 * is signed in but **not** yet onboarded — `users.onboarded_at` is null
 * because the route never stamps it.
 *
 * Distinct from `signInAs(persona)` (in `@repo/shared/testing/auth.ts`),
 * which loads a cached storageState for one of the pre-seeded persona
 * accounts. Those personas are already onboarded; their
 * `users.onboarded_at` is non-null at JIT-provision time, so they can
 * never exercise the un-onboarded branch of `/onboarding`. This seam
 * is the additive complement: every call mints a new user, so the
 * un-onboarded branch is freshly reachable.
 *
 * Security boundary (`risk::high`):
 *
 *   - The seam refuses to run unless the dev-only debug route is
 *     reachable. Production builds gate the route off with
 *     `DEBUG_TEST_USER_CREATION_ENABLED` (see
 *     `apps/api/src/routes/debug/create-test-user.ts`); the route
 *     returns 404 when the gate is closed, and this helper throws
 *     with an actionable message naming the env var.
 *   - The `sk_test_` boundary is enforced INSIDE the route (via
 *     `assertClerkTestSecretKey`). This helper never reads
 *     `CLERK_SECRET_KEY` directly — the secret stays on the API
 *     server. The minted password is returned in the response and
 *     held only in this function's locals; it is never logged or
 *     persisted to disk.
 *   - The minted email follows Clerk's `+clerk_test+<uuid>@example.com`
 *     pattern so parallel test runs cannot collide on the unique-email
 *     constraint in Clerk's user pool.
 *
 * Usage (acceptance step):
 *
 *   import { signInAsFreshUser } from '../fixtures/freshUser';
 *
 *   const { user } = await signInAsFreshUser({ page });
 *   await page.goto('/onboarding');
 *   // page is signed in as `user`, user.onboardedAt is null
 *
 * The scenario tagging gate (`@pending` until Issue #383 flips the
 * Playwright webServer to the real Astro app) is enforced at the
 * `.feature` level — this helper itself is functional today against a
 * real Astro server with `@clerk/astro` mounted.
 */
import { clerk } from '@clerk/testing/playwright';
import type { Page } from '@playwright/test';

/**
 * Shape of the JSON body the dev route returns on the happy path. The
 * Playwright fixture only consumes a subset of this; the route's
 * contract test locks the rest.
 */
interface CreateTestUserResponse {
  readonly success: true;
  readonly data: {
    readonly userId: string;
    readonly email: string;
    readonly emailVerified: boolean;
    readonly password: string;
    readonly signInTicket: string;
    readonly signInTicketExpiresInSeconds: number;
  };
}

/**
 * Public shape of a freshly minted, signed-in test user. Stripped of
 * the password and ticket so step-definition code does not accidentally
 * log them. Callers that need the raw response use
 * `mintFreshTestUser()` instead.
 */
export interface FreshTestUser {
  readonly userId: string;
  readonly email: string;
}

/**
 * Options for `signInAsFreshUser` and `mintFreshTestUser`.
 *
 *   - `page` — the Playwright `Page` to sign in. The helper calls
 *     `page.goto('/')` before invoking `clerk.signIn` per the
 *     `@clerk/testing/playwright` contract (Clerk must be loaded
 *     before the helper runs).
 *   - `apiBaseUrl` — base URL of the API server hosting the debug
 *     route. Defaults to `http://localhost:8787` (the local dev
 *     server's port; see `apps/api/src/local.ts`).
 *   - `emailVerified` — whether the new user lands with a verified
 *     primary email. Defaults to `true` so the standard happy-path
 *     fixture does not need to spell it out.
 *   - `firstName` / `lastName` — optional metadata forwarded to
 *     `createTestUser`. Most onboarding scenarios fill these via the
 *     form, so the default is omitted.
 *   - `fetchImpl` — optional fetch override for unit tests (the
 *     acceptance tier never uses this; injection is here so a
 *     contract test of the helper itself can mock the route).
 */
export interface FreshUserOptions {
  readonly page: Page;
  readonly apiBaseUrl?: string;
  readonly emailVerified?: boolean;
  readonly firstName?: string;
  readonly lastName?: string;
  readonly fetchImpl?: typeof fetch;
}

const DEFAULT_API_BASE_URL = 'http://localhost:8787';

/**
 * Generate a fresh, unique `+clerk_test@` email. The UUID suffix is
 * scoped to the local module call so parallel Playwright workers can
 * mint users in parallel without colliding on Clerk's
 * unique-email constraint.
 */
function freshClerkTestEmail(): string {
  const uniqueId = globalThis.crypto.randomUUID();
  return `fresh-onboarding+clerk_test+${uniqueId}@example.com`;
}

/**
 * Mint a brand-new `+clerk_test@` user against the dev-only debug
 * route. Returns the route's response body verbatim so callers that
 * need the raw `signInTicket` (e.g. a fixture that bypasses Clerk's
 * testing helper) can use it directly.
 *
 * Most callers want `signInAsFreshUser()` instead — this function is
 * the lower-level seam.
 *
 * @throws `Error` when the route returns a non-2xx, including the
 *   route's own error envelope verbatim so the operator can see the
 *   `code` (`NOT_FOUND`, `MISCONFIGURED_INSTANCE`, etc.).
 */
export async function mintFreshTestUser(
  options: Omit<FreshUserOptions, 'page'>,
): Promise<CreateTestUserResponse['data']> {
  const {
    apiBaseUrl = DEFAULT_API_BASE_URL,
    emailVerified = true,
    firstName,
    lastName,
    fetchImpl = fetch,
  } = options;

  const email = freshClerkTestEmail();
  const url = `${apiBaseUrl}/api/v1/_debug/create-test-user`;

  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email,
      emailVerified,
      ...(firstName ? { firstName } : {}),
      ...(lastName ? { lastName } : {}),
    }),
  });

  if (response.status === 404) {
    throw new Error(
      `mintFreshTestUser: ${url} returned 404. The dev-only debug route ` +
        'is gated by DEBUG_TEST_USER_CREATION_ENABLED=true; set the ' +
        'env var on the local API server (apps/api/src/local.ts ' +
        'forwards it) before running fresh-user scenarios.',
    );
  }

  if (!response.ok) {
    const envelope = (await response.json().catch(() => null)) as {
      error?: { code?: string; message?: string };
    } | null;
    const code = envelope?.error?.code ?? 'UNKNOWN';
    const message = envelope?.error?.message ?? 'no message';
    throw new Error(`mintFreshTestUser: ${url} returned ${response.status} ${code} — ${message}`);
  }

  const body = (await response.json()) as CreateTestUserResponse;
  return body.data;
}

/**
 * Mint a fresh user and sign them into the supplied Playwright `page`.
 * Returns the public-safe `FreshTestUser` shape (no password, no
 * ticket) for the calling step to thread into subsequent assertions.
 *
 * After this returns, `page` is signed in as the new user. The
 * caller is responsible for navigating to the route under test
 * (typically `/onboarding`).
 *
 * @throws `Error` when route returns non-2xx (see `mintFreshTestUser`).
 * @throws `Error` from `@clerk/testing/playwright` when `clerk.signIn`
 *   fails (e.g. CLERK_SECRET_KEY missing in the Playwright runtime).
 */
export async function signInAsFreshUser(options: FreshUserOptions): Promise<{
  readonly user: FreshTestUser;
}> {
  const { page } = options;
  const data = await mintFreshTestUser(options);

  // `@clerk/testing/playwright` requires Clerk to be loaded on the
  // page before `clerk.signIn` runs. Land on `/` first — every Astro
  // route mounts the Clerk integration via the root layout.
  await page.goto('/');

  // The `emailAddress` path uses CLERK_SECRET_KEY to mint a sign-in
  // token server-side and bypasses verification entirely. We prefer
  // this over the password strategy because (a) our route already
  // marked the email verified, and (b) the password strategy can
  // trip MFA / bot-detection on warm runs. The route's
  // `signInTicket` field is unused on this path but is part of the
  // wire contract so a future fixture that wants explicit ticket
  // exchange (e.g. for instances that disable the email-token path)
  // can use it directly.
  await clerk.signIn({ page, emailAddress: data.email });

  return {
    user: {
      userId: data.userId,
      email: data.email,
    },
  };
}
