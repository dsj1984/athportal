/**
 * @repo/shared/testing/clerkTickets — `mintSignInTicket()` helper.
 *
 * Mints a short-lived Clerk **sign-in token** for one of the QA bootstrap
 * personas (`athlete`, `coach`, `org-admin`). The QA agent-runner uses
 * this to sign in as the persona without going through email-code 2FA:
 *
 *   1. Read the persona's Clerk subject ID from `clerk-personas.json`.
 *   2. POST `/v1/sign_in_tokens` (via the Clerk Backend SDK) with
 *      `{ userId, expiresInSeconds }`.
 *   3. Return the one-shot ticket. The caller exchanges it for a session
 *      cookie via Clerk's frontend ticket-flow (`/sign-in?__clerk_ticket=…`).
 *
 * Story #881 / Task #897.
 *
 * Security boundary (`risk::high`).
 *
 *   - **`sk_test_` enforcement.** The helper refuses to run when
 *     `CLERK_SECRET_KEY` is missing, empty, or doesn't start with the
 *     literal prefix `sk_test_`. A `sk_live_` key (or any other prefix)
 *     throws synchronously — minting a sign-in token against a live
 *     Clerk instance would forge a session for a real user account.
 *   - **Subject IDs are not secrets** (Clerk publishes them in every JWT
 *     `sub` claim), so persisting them in `clerk-personas.json` is fine.
 *     The secret is `CLERK_SECRET_KEY`, which lives in env vars only.
 *   - **No persistence.** The minted ticket is never written to disk or
 *     logged. The integration test (Task #896) asserts shape only.
 *   - **No PII in logs.** The thrown error messages never include the
 *     secret key, even when reporting the wrong prefix — only the first
 *     three characters are echoed so operators can confirm the source
 *     of the misconfiguration without leaking the secret.
 */

import { createClerkClient } from '@clerk/backend';

import type { ClerkPersona } from './clerkPersonas';
import { readPersonaClerkIds } from './clerkPersonas';

/** Default ticket lifetime — long enough for the runner's sign-in step, short enough to limit blast radius if leaked. */
export const DEFAULT_SIGN_IN_TICKET_TTL_SECONDS = 30;

/**
 * Hard upper bound on `expiresInSeconds`. A buggy or malicious caller
 * could otherwise mint a 24-hour ticket; the `sk_test_` boundary
 * contains the blast radius to the test instance, but five minutes is
 * the longest TTL any real runner workflow needs. Defence-in-depth:
 * `mintSignInTicket` clamps to this ceiling silently rather than
 * throwing, so a caller that overshoots still gets a working ticket —
 * just one with a sensible lifetime.
 *
 * Story #904 / audit-security finding #2.
 */
export const MAX_SIGN_IN_TICKET_TTL_SECONDS = 300;

/** Required env-var prefix for Clerk test-instance secret keys. */
const REQUIRED_SECRET_KEY_PREFIX = 'sk_test_';

/** Env var the helper reads. Kept as a constant so tests can shadow without typos. */
const SECRET_KEY_ENV_VAR = 'CLERK_SECRET_KEY';

/**
 * Shape returned by `mintSignInTicket`. Mirrors the Clerk Backend SDK's
 * `SignInToken` resource but narrows to the fields the QA runner needs.
 *
 * - `ticket`: the one-shot string the frontend exchanges for a session.
 * - `userId`: the Clerk subject ID this ticket was minted against (echoed back for trace).
 * - `expiresInSeconds`: the TTL the ticket was minted with (echoed back for trace).
 */
export interface SignInTicket {
  readonly ticket: string;
  readonly userId: string;
  readonly expiresInSeconds: number;
}

/**
 * Options for `mintSignInTicket()`.
 *
 * - `persona`: the canonical QA persona to mint the ticket for. Resolved
 *   to a Clerk subject ID via `readPersonaClerkIds()`.
 * - `expiresInSeconds`: optional TTL override (defaults to 30s).
 * - `secretKey`: optional override; defaults to `process.env.CLERK_SECRET_KEY`.
 *   Only used by tests that need to drive the guard explicitly.
 * - `clerkFactory`: optional factory injection for unit tests. Production
 *   callers omit this and the helper calls `createClerkClient` directly.
 * - `personaIdsReader`: optional reader injection for unit tests.
 *   Defaults to `readPersonaClerkIds`.
 */
export interface MintSignInTicketOptions {
  persona: ClerkPersona;
  expiresInSeconds?: number;
  secretKey?: string | undefined;
  clerkFactory?: typeof createClerkClient;
  personaIdsReader?: typeof readPersonaClerkIds;
}

/**
 * Validate the secret-key env var. Throws synchronously with an
 * actionable message when the key is missing, empty, or has the wrong
 * prefix. Returns the validated key on success.
 *
 * This is the **load-bearing security boundary** for the helper.
 * `sk_live_…` MUST never reach `createClerkClient`, because the resulting
 * `signInTokens.createSignInToken` call would forge a session for a real
 * user account in the production Clerk instance.
 */
export function assertClerkTestSecretKey(rawKey: string | undefined): string {
  if (typeof rawKey !== 'string' || rawKey.length === 0) {
    throw new Error(
      `mintSignInTicket: ${SECRET_KEY_ENV_VAR} is not set. ` +
        `This helper signs in QA personas against the Clerk **test** ` +
        `instance and refuses to run without a 'sk_test_' key. Export ` +
        `${SECRET_KEY_ENV_VAR} from the Clerk dashboard's "Developers → ` +
        `API keys" page for the test instance before invoking the runner.`,
    );
  }

  if (!rawKey.startsWith(REQUIRED_SECRET_KEY_PREFIX)) {
    // Echo only the first three chars so operators can confirm the
    // source of the misconfiguration without leaking the secret to logs.
    const prefixHint = rawKey.slice(0, 3);
    throw new Error(
      `mintSignInTicket: ${SECRET_KEY_ENV_VAR} must start with ` +
        `'${REQUIRED_SECRET_KEY_PREFIX}' (got prefix '${prefixHint}…'). ` +
        `This helper refuses to mint sign-in tickets against any key ` +
        `other than a Clerk **test** instance secret. Minting against ` +
        `'sk_live_' would forge a session for a real user account.`,
    );
  }

  return rawKey;
}

/**
 * Mint a one-shot Clerk sign-in ticket for the named QA persona.
 *
 * Resolves the persona's Clerk subject ID via `readPersonaClerkIds()`,
 * validates `CLERK_SECRET_KEY` carries a `sk_test_` prefix, and POSTs to
 * `/v1/sign_in_tokens` via the Clerk Backend SDK. Returns the issued
 * ticket plus echoed `userId` and `expiresInSeconds` for trace logging.
 *
 * @throws `Error` when `CLERK_SECRET_KEY` is missing, empty, or non-test.
 * @throws `Error` when the persona's Clerk subject ID is not populated
 *   in `clerk-personas.json` (the underlying reader's actionable error
 *   is re-thrown verbatim, naming the runbook).
 * @throws `Error` propagated from `createSignInToken` when Clerk returns
 *   a non-2xx (e.g. unknown user ID, rate limited).
 */
export async function mintSignInTicket(options: MintSignInTicketOptions): Promise<SignInTicket> {
  const {
    persona,
    expiresInSeconds: rawExpiresInSeconds = DEFAULT_SIGN_IN_TICKET_TTL_SECONDS,
    secretKey = process.env[SECRET_KEY_ENV_VAR],
    clerkFactory = createClerkClient,
    personaIdsReader = readPersonaClerkIds,
  } = options;

  // Clamp the requested TTL to the documented ceiling. A caller asking
  // for 86400 (24h) ends up with 300 (5min); a caller asking for 60
  // gets 60 verbatim. Story #904 / audit-security finding #2.
  const expiresInSeconds = Math.min(rawExpiresInSeconds, MAX_SIGN_IN_TICKET_TTL_SECONDS);

  // Step 1: validate the secret key BEFORE any other work. This is the
  // load-bearing check — every other branch in this function assumes a
  // test-instance key.
  const validatedKey = assertClerkTestSecretKey(secretKey);

  // Step 2: resolve persona → subject ID. The reader throws an
  // actionable, runbook-linked error when the JSON is unpopulated.
  const personaIds = personaIdsReader();
  const userId = personaIds[persona];

  // Step 3: mint the ticket. The Backend SDK handles the HTTP call,
  // retries, and error-body parsing.
  const client = clerkFactory({ secretKey: validatedKey });
  const signInToken = await client.signInTokens.createSignInToken({
    userId,
    expiresInSeconds,
  });

  return Object.freeze({
    ticket: signInToken.token,
    userId: signInToken.userId,
    expiresInSeconds,
  });
}
