/**
 * @repo/shared/testing/auth — auth helpers for the test pyramid.
 *
 * Two tiers of helpers ship from this module:
 *
 * 1. **Contract tier** — `authHeaders(user)` (Epic #4 / Story #172).
 *    Returns the `Authorization` + `x-clerk-user-id` header bag the
 *    Hono contract harness wants for `app.request(path, { headers })`.
 *    Working as designed.
 *
 * 2. **Acceptance tier** — `signInAs(persona)`. Currently a deferred
 *    placeholder. Story #329 / Task #348 shipped an implementation that
 *    signed JWTs locally with a `CLERK_TESTING_TOKEN_SIGNING_KEY` env
 *    var expected to be a Clerk-issued RSA private key — but Clerk
 *    does not expose such a key (testing tokens are server-minted via
 *    `clerkClient.testingTokens.createTestingToken()`, not signed
 *    client-side). The phantom env var and the broken JWT-signing path
 *    have been removed; the seam is being rewritten in **Issue #371**
 *    to use `@clerk/testing/playwright`'s `clerk.signIn` API. Until
 *    that lands, `signInAs(persona)` throws with a reference to the
 *    issue, except `signInAs('anonymous')` which still returns an
 *    empty StorageState for explicit signed-out projects.
 *
 * Per docs/architecture.md §1 the auth provider is Clerk
 * (`@clerk/astro` at MVP). The persona ↔ role mapping below is the
 * single source of truth and is kept here so Issue #371 inherits a
 * stable contract.
 */

// ---------------------------------------------------------------------------
// Contract-tier helper (unchanged from Story #172 / Task #181)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Acceptance-tier seam (new — Story #329 / Task #348)
// ---------------------------------------------------------------------------

/**
 * MVP persona kinds the test-auth seam serves.
 *
 * The string form (`'org admin'`, `'dev admin'`) is what the Gherkin
 * step `Given I am signed in as {string}` recognises; the keyed form
 * (`'org-admin'`, `'dev-admin'`) is how Playwright projects address the
 * same persona in `playwright.config.ts`. Both spellings resolve to the
 * same `PersonaFixture` via `resolvePersona()`.
 */
export type Persona = 'anonymous' | 'athlete' | 'coach' | 'org-admin' | 'dev-admin';

/**
 * RBAC role the persona carries inside the application. Mirrors
 * `packages/shared/src/rbac/types.ts` (which lands with Epic #7's
 * production-auth Story). Declared inline here so the testing seam
 * stays self-contained until that module ships.
 */
export type PersonaRole = 'dev_admin' | 'org_admin' | 'team_admin' | 'member';

/**
 * Static record bound to each persona. The seeded Clerk test users
 * (`<persona>@test.invalid`) live in the Clerk test instance — this
 * module is the single source of truth for the persona ↔ Clerk-subject
 * ↔ role mapping consumed by acceptance scenarios.
 *
 * `clerkSubjectId` is the deterministic stub the contract-tier middleware
 * recognises and the testing-token JWT carries as its `sub` claim.
 */
export interface PersonaFixture {
  readonly persona: Persona;
  readonly email: string;
  readonly clerkSubjectId: string;
  readonly role: PersonaRole | null;
  readonly orgId: string | null;
  readonly teamId: string | null;
}

/**
 * The MVP persona → fixture table. Values are synthetic and use the
 * `.invalid` TLD per RFC 2606 so an inadvertent send can never reach a
 * real inbox. The synthetic-PII guard (`safety.ts`) re-asserts this
 * invariant when a fixture is consumed.
 */
export const PERSONA_FIXTURES: Readonly<Record<Persona, PersonaFixture>> = Object.freeze({
  anonymous: Object.freeze({
    persona: 'anonymous',
    email: 'anonymous@test.invalid',
    clerkSubjectId: 'user_test_anonymous',
    role: null,
    orgId: null,
    teamId: null,
  }),
  athlete: Object.freeze({
    persona: 'athlete',
    email: 'athlete@test.invalid',
    clerkSubjectId: 'user_test_athlete',
    role: 'member',
    orgId: null,
    teamId: null,
  }),
  coach: Object.freeze({
    persona: 'coach',
    email: 'coach@test.invalid',
    clerkSubjectId: 'user_test_coach',
    role: 'team_admin',
    orgId: 'org_test_a',
    teamId: 'team_test_a_1',
  }),
  'org-admin': Object.freeze({
    persona: 'org-admin',
    email: 'org-admin@test.invalid',
    clerkSubjectId: 'user_test_org_admin',
    role: 'org_admin',
    orgId: 'org_test_a',
    teamId: null,
  }),
  'dev-admin': Object.freeze({
    persona: 'dev-admin',
    email: 'dev-admin@test.invalid',
    clerkSubjectId: 'user_test_dev_admin',
    role: 'dev_admin',
    orgId: null,
    teamId: null,
  }),
});

/**
 * Accept the canonical Gherkin spellings (`'org admin'`, `'dev admin'`)
 * **and** the Playwright project-key form (`'org-admin'`, `'dev-admin'`)
 * for `'athlete'`, `'coach'`, `'org admin'`, `'dev admin'`, plus
 * `'anonymous'`.
 *
 * Unknown labels throw a `TypeError` whose message lists the accepted
 * spellings so a typo at scenario-authoring time fails loudly rather
 * than silently signing in as the wrong persona.
 */
export function resolvePersona(label: string): PersonaFixture {
  if (typeof label !== 'string') {
    throw new TypeError(
      `resolvePersona: expected a string persona label, received ${typeof label}`,
    );
  }
  const normalized = label.trim().toLowerCase().replace(/\s+/g, '-');
  const fixture = PERSONA_FIXTURES[normalized as Persona];
  if (!fixture) {
    const accepted = ['anonymous', 'athlete', 'coach', 'org admin', 'dev admin']
      .map((s) => `'${s}'`)
      .join(', ');
    throw new TypeError(
      `resolvePersona: unknown persona ${JSON.stringify(label)}. ` +
        `Accepted personas: ${accepted}.`,
    );
  }
  return fixture;
}

// ---------------------------------------------------------------------------
// Playwright StorageState shape (subset re-declared to avoid a hard
// dependency on @playwright/test inside @repo/shared)
// ---------------------------------------------------------------------------

export interface StorageStateCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'Strict' | 'Lax' | 'None';
}

export interface StorageState {
  cookies: StorageStateCookie[];
  origins: Array<{ origin: string; localStorage: Array<{ name: string; value: string }> }>;
}

/**
 * Acceptance-tier sign-in entry point — currently a deferred placeholder.
 *
 * - `signInAs('anonymous')` returns an empty `StorageState` (no cookies,
 *   no origins). Useful for projects that want an explicit signed-out
 *   baseline; works today.
 * - `signInAs('athlete' | 'coach' | 'org-admin' | 'dev-admin')` throws
 *   a clear error pointing at **Issue #371**, which tracks the rewrite
 *   to `@clerk/testing/playwright`'s `clerk.signIn` API. The previous
 *   implementation (Story #329 / Task #348) signed JWTs locally with a
 *   `CLERK_TESTING_TOKEN_SIGNING_KEY` env var Clerk does not actually
 *   expose — see the issue body for the full root-cause analysis.
 * - `signInAs('unknown')` throws a `TypeError` listing the accepted
 *   persona spellings (unchanged).
 *
 * Callers that already have a label coming from a Gherkin step should
 * pass the label through `resolvePersona(label).persona` first, or
 * call `signInAs` with the resolved key directly.
 */
export async function signInAs(persona: Persona): Promise<StorageState> {
  if (persona === 'anonymous') {
    return { cookies: [], origins: [] };
  }
  if (!PERSONA_FIXTURES[persona]) {
    throw new TypeError(
      `signInAs: unknown persona ${JSON.stringify(persona)}. ` +
        "Accepted personas: 'anonymous', 'athlete', 'coach', 'org-admin', 'dev-admin'.",
    );
  }
  throw new Error(
    `signInAs(${JSON.stringify(persona)}): the acceptance-tier test-auth seam is currently deferred ` +
      'pending the refactor to @clerk/testing/playwright (see GitHub Issue #371). ' +
      "Only signInAs('anonymous') is implemented today.",
  );
}
