/**
 * @repo/shared/testing/auth — auth helpers for the test pyramid.
 *
 * Two tiers of helpers ship from this module:
 *
 * 1. **Contract tier** — `authHeaders(user)` (Epic #4 / Story #172).
 *    Returns the `Authorization` + `x-clerk-user-id` header bag the
 *    Hono contract harness wants for `app.request(path, { headers })`.
 *    Unchanged by this Story.
 *
 * 2. **Acceptance tier** — `signInAs(persona)` (Story #329 / Task #348).
 *    Mints a real Clerk testing-token JWT against a Clerk **test
 *    instance** and returns a Playwright `StorageState` whose
 *    `__session` cookie carries that JWT. There is no dev-only auth
 *    bypass — the seam targets the real Clerk SDK against a real test
 *    instance per the security baseline
 *    (`.agents/rules/security-baseline.md`).
 *
 * Per docs/architecture.md §1 the auth provider is Clerk
 * (`@clerk/astro` at MVP). The seam keeps the persona ↔ role mapping
 * documented at one place (this file) so the Gherkin step
 * `Given I am signed in as {string}` and the per-persona Playwright
 * projects (`apps/web/playwright.config.ts`) resolve identically.
 */

import { signJwt } from '@clerk/backend/jwt';

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
 * Cookie domain for the `__session` cookie the seam plants. Defaults to
 * `127.0.0.1` to match Playwright's `webServer.url` in
 * `apps/web/playwright.config.ts`. Override with the
 * `E2E_STORAGE_COOKIE_DOMAIN` env var when running against a preview
 * environment.
 */
function sessionCookieDomain(): string {
  return process.env.E2E_STORAGE_COOKIE_DOMAIN ?? '127.0.0.1';
}

/**
 * Read the Clerk testing-token signing key from the environment. The key
 * is **only valid on the Clerk test instance** — see
 * `docs/patterns.md` § _Authenticated test sessions (Clerk test instance)_
 * for the rotation runbook.
 *
 * Throws if missing so a forgotten environment variable fails the run
 * fast rather than silently producing unsigned tokens.
 */
function requireTestingTokenKey(): string {
  const key = process.env.CLERK_TESTING_TOKEN_SIGNING_KEY;
  if (!key || typeof key !== 'string') {
    throw new Error(
      'signInAs: CLERK_TESTING_TOKEN_SIGNING_KEY is not set. ' +
        'Set it from the Clerk dashboard (Test Instance → API Keys → Testing Tokens). ' +
        'See docs/patterns.md § Authenticated test sessions (Clerk test instance).',
    );
  }
  return key;
}

/**
 * Mint a Clerk testing-token JWT for the supplied persona's fixture.
 *
 * The token's `sub` is the persona's `clerkSubjectId`; the `iss` is the
 * test-instance Clerk issuer. The Clerk SDK accepts this JWT as a valid
 * session on the test instance and rejects it on the production
 * instance — leaking the signing key cannot compromise production
 * users.
 *
 * Exported separately from `signInAs` so callers that only need the
 * raw JWT (e.g. a contract test driving the production middleware with
 * a real signed token) can request it without building a StorageState.
 */
export async function mintTestingToken(persona: Persona): Promise<string> {
  if (persona === 'anonymous') {
    throw new TypeError(
      'mintTestingToken: the "anonymous" persona has no session — call signInAs("anonymous") if you want an empty StorageState.',
    );
  }
  const fixture = PERSONA_FIXTURES[persona];
  if (!fixture) {
    throw new TypeError(`mintTestingToken: unknown persona ${JSON.stringify(persona)}`);
  }
  const key = requireTestingTokenKey();
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + 60 * 60; // 1 hour — well within Playwright suite lifetime
  const payload: Record<string, unknown> = {
    sub: fixture.clerkSubjectId,
    iss: process.env.CLERK_TEST_INSTANCE_ISSUER ?? 'https://test.clerk.invalid',
    iat: issuedAt,
    exp: expiresAt,
    nbf: issuedAt,
    azp: process.env.CLERK_TEST_INSTANCE_AZP ?? 'https://test.clerk.invalid',
    email: fixture.email,
    role: fixture.role,
    org_id: fixture.orgId,
    team_id: fixture.teamId,
  };
  // Clerk's `@clerk/backend/jwt` `signJwt` accepts an RSA key (PEM
  // string or JSON Web Key). The testing-token signing key shipped by
  // Clerk's dashboard is an RSA private key — RS256 is the only
  // algorithm the test instance accepts. Keeping the algorithm pinned
  // here means a key rotation that swaps algorithms (vanishingly
  // unlikely on Clerk's side) fails loud rather than silently producing
  // unverifiable tokens.
  return signJwt(payload, key, { algorithm: 'RS256' });
}

/**
 * Build the `__session` cookie record Playwright wants when restoring a
 * `StorageState`. Carries `HttpOnly` + `Secure` + `SameSite=Lax` per the
 * security baseline.
 */
export async function sessionCookieFor(persona: Persona): Promise<StorageStateCookie> {
  const token = await mintTestingToken(persona);
  const expires = Math.floor(Date.now() / 1000) + 60 * 60;
  return {
    name: '__session',
    value: token,
    domain: sessionCookieDomain(),
    path: '/',
    expires,
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
  };
}

/**
 * Acceptance-tier sign-in entry point. Returns a Playwright
 * `StorageState` whose `__session` cookie carries a real Clerk
 * testing-token JWT for the requested persona.
 *
 * - `signInAs('anonymous')` returns an empty `StorageState` (no cookies,
 *   no origins) — useful when a project wants an explicit signed-out
 *   baseline.
 * - `signInAs('unknown')` throws a `TypeError` listing the accepted
 *   persona spellings.
 *
 * Callers that already have a label coming from a Gherkin step pass
 * the label through `resolvePersona(label).persona` first, or call
 * `signInAs` with the resolved key directly.
 */
export async function signInAs(persona: Persona): Promise<StorageState> {
  if (persona === 'anonymous') {
    return { cookies: [], origins: [] };
  }
  const cookie = await sessionCookieFor(persona);
  return {
    cookies: [cookie],
    origins: [],
  };
}
