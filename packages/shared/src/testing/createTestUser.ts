/**
 * @repo/shared/testing/createTestUser — programmatic Clerk Test-instance user creation.
 *
 * Companion to `mintSignInTicket()`. Where the ticket helper signs in
 * **existing** personas (the three QA bootstrap users), this helper
 * **creates** fresh, ephemeral users on demand against the Clerk Test
 * instance via the Backend SDK. Story #953 / F2.
 *
 * The QA-corpus Test Plans in Story #945 Session 2 (signup happy-path,
 * onboarding gate, role assignment) all require provisioning new
 * accounts that the persona-graph seed deliberately omits. The plain
 * `/sign-up` form is blocked by Cloudflare Turnstile on the Test
 * instance (see docs/runbooks/clerk-persona-bootstrap.md § "Turnstile
 * and programmatic flows"), so programmatic user creation has to go
 * through the Backend SDK — Turnstile is a frontend bot-protection
 * check and the Backend API bypasses it entirely.
 *
 * Security boundary (`risk::high`).
 *
 *   - **`sk_test_` enforcement.** Mirrors `mintSignInTicket`. Refuses
 *     to run unless `CLERK_SECRET_KEY` starts with `sk_test_`. Creating
 *     users against a live Clerk instance would create real,
 *     dashboard-visible accounts.
 *   - **Test-channel email warning.** Clerk's "+clerk_test@" email
 *     convention is what makes a Test-instance user provisionable
 *     without an inbox: those addresses use a deterministic
 *     verification code (`424242`). Callers that pass an address
 *     outside that convention get a warning logged so they understand
 *     why their downstream email-verification step might wedge — see
 *     docs/runbooks/clerk-persona-bootstrap.md § "Test-channel emails".
 *   - **No persistence.** The helper does not write the new user's
 *     password, ID, or email to disk. Callers that need to surface
 *     these (e.g. the dev route) are responsible for keeping them in
 *     memory only.
 *   - **No PII in logs.** The thrown error messages never echo the
 *     email or password.
 */

import { createClerkClient } from '@clerk/backend';

import { assertClerkTestSecretKey } from './clerkTickets';

/** Env var the helper reads. */
const SECRET_KEY_ENV_VAR = 'CLERK_SECRET_KEY';

/**
 * Pattern for Clerk's testing-email addresses. Any email whose local
 * part ends with `+clerk_test` (e.g. `signup-happy+clerk_test@example.com`)
 * is recognised by the Clerk Test instance as a test channel: its
 * verification code is the fixed string `424242`, no real inbox is
 * involved. Callers using any other shape will not be able to retrieve
 * a verification code without a real inbox.
 *
 * Reference: https://clerk.com/docs/testing/test-emails-and-phones
 */
const CLERK_TEST_EMAIL_PATTERN = /\+clerk_test@/i;

/** Deterministic verification code for `+clerk_test@` emails on Test instances. */
export const CLERK_TEST_VERIFICATION_CODE = '424242';

/**
 * Default password for created test users when the caller does not
 * supply one. Long, mixed-case, includes a digit and a symbol — well
 * above Clerk's default password-policy minimums so the create call
 * does not need `skipPasswordChecks`.
 *
 * Test-instance only. Refused at the `sk_test_` boundary against any
 * non-test instance, so this string never reaches a live Clerk account.
 */
const DEFAULT_TEST_PASSWORD = 'TestUser!Passw0rd-2026';

/**
 * Shape returned by `createTestUser`. Narrows Clerk's `User` resource
 * to the fields callers of this helper actually use. The QA runner and
 * the dev route are the two real callers; both just want the new
 * subject ID plus a confirmation of which email + verified flag the
 * created user ended up with.
 */
export interface CreatedTestUser {
  readonly userId: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly password: string;
}

/**
 * Options for `createTestUser()`.
 *
 * - `email`: the email to assign to the new user. STRONGLY recommended
 *   to use Clerk's `+clerk_test@…` channel pattern — see module docs
 *   and the bootstrap runbook for why. A non-test email logs a warning
 *   but does not refuse, because some Plans (e.g. testing the actual
 *   rejection of a malformed email) legitimately want a non-test value.
 * - `password`: optional override. Defaults to a strong fixed password
 *   bounded by the `sk_test_` boundary. Pass an override only when a
 *   Plan needs a known password to type into the sign-in form later.
 * - `emailVerified`: when true (default), the new user lands with a
 *   verified primary email. When false, the helper creates the user
 *   first then adds the email as unverified via the Backend
 *   email-addresses endpoint — the unverified-email path that
 *   `tp-identity-signin-email-not-verified` exercises.
 * - `firstName` / `lastName`: optional metadata. Most Plans don't need
 *   these; the signup Plan that fills the form needs them so the
 *   resulting user's display name matches the form input.
 * - `secretKey`: optional override; defaults to
 *   `process.env.CLERK_SECRET_KEY`. Tests inject explicit values to
 *   drive the guard deterministically.
 * - `clerkFactory`: optional factory injection for unit tests.
 * - `warn`: optional `console.warn` injection for unit tests. Defaults
 *   to `console.warn`. The helper warns when `email` does not match
 *   the `+clerk_test@` pattern.
 */
export interface CreateTestUserOptions {
  email: string;
  password?: string;
  emailVerified?: boolean;
  firstName?: string;
  lastName?: string;
  secretKey?: string | undefined;
  clerkFactory?: typeof createClerkClient;
  warn?: (message: string) => void;
}

/**
 * Returns true when the email follows Clerk's `+clerk_test@` testing
 * channel convention. Exported for the dev route to share the same
 * predicate without duplicating the regex.
 */
export function isClerkTestChannelEmail(email: string): boolean {
  return CLERK_TEST_EMAIL_PATTERN.test(email);
}

/**
 * Create a fresh user on the Clerk Test instance via the Backend SDK.
 *
 * Verified path (`emailVerified: true`, the default): a single
 * `users.createUser` call with `emailAddress: [email]` — Clerk's
 * Backend API auto-verifies emails supplied at create time, which is
 * exactly what most callers want.
 *
 * Unverified path (`emailVerified: false`): the user is created with
 * no email first, then the email is added via
 * `emailAddresses.createEmailAddress` with `verified: false, primary: true`.
 * This is the route to a user whose `email_verified` claim is false —
 * what the `tp-identity-signin-email-not-verified` Plan needs.
 *
 * @throws `Error` when `CLERK_SECRET_KEY` is missing, empty, or non-test.
 * @throws `Error` propagated from the Clerk SDK on duplicate email,
 *   policy rejection, or 5xx.
 */
export async function createTestUser(options: CreateTestUserOptions): Promise<CreatedTestUser> {
  const {
    email,
    password = DEFAULT_TEST_PASSWORD,
    emailVerified = true,
    firstName,
    lastName,
    secretKey = process.env[SECRET_KEY_ENV_VAR],
    clerkFactory = createClerkClient,
    warn = (msg: string) => console.warn(msg),
  } = options;

  // Step 1: validate the secret-key boundary BEFORE any other work.
  const validatedKey = assertClerkTestSecretKey(secretKey);

  // Step 2: warn when the email is outside Clerk's test-channel
  // convention. Don't refuse — some Plans legitimately want a
  // non-test address (e.g. asserting that a malformed email is
  // rejected at the form). The warning names the runbook so the
  // operator can self-serve.
  if (!isClerkTestChannelEmail(email)) {
    warn(
      `createTestUser: email does not match Clerk's '+clerk_test@' ` +
        `testing-channel pattern. Verification codes for non-test ` +
        `addresses cannot be retrieved without a real inbox. See ` +
        `docs/runbooks/clerk-persona-bootstrap.md § "Test-channel emails".`,
    );
  }

  const client = clerkFactory({ secretKey: validatedKey });

  // Step 3: create the user. Two paths — verified vs unverified.
  if (emailVerified) {
    const user = await client.users.createUser({
      emailAddress: [email],
      password,
      ...(firstName ? { firstName } : {}),
      ...(lastName ? { lastName } : {}),
      // skipPasswordChecks: defence-in-depth against a Clerk instance
      // whose password policy rejects the default. We're past the
      // sk_test_ guard, so this only affects the test instance.
      skipPasswordChecks: true,
    });

    return Object.freeze({
      userId: user.id,
      email,
      emailVerified: true,
      password,
    });
  }

  // Unverified path: create the user with no email first, then add
  // the email separately with `verified: false`.
  const user = await client.users.createUser({
    password,
    ...(firstName ? { firstName } : {}),
    ...(lastName ? { lastName } : {}),
    skipPasswordChecks: true,
  });

  await client.emailAddresses.createEmailAddress({
    userId: user.id,
    emailAddress: email,
    verified: false,
    primary: true,
  });

  return Object.freeze({
    userId: user.id,
    email,
    emailVerified: false,
    password,
  });
}
