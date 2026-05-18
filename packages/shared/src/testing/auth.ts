/**
 * @repo/shared/testing/auth — auth helpers for the test pyramid.
 *
 * Two tiers of helpers ship from this module:
 *
 * 1. **Contract tier** — `authHeaders(user)` (Story #172 / Task #181).
 *    Returns the `Authorization` + `x-clerk-user-id` header bag the
 *    Hono contract harness wants for `app.request(path, { headers })`.
 *    Unchanged by this Story.
 *
 * 2. **Acceptance tier** — `signInAs({ page, persona })` (Story #371).
 *    Drives the canonical `@clerk/testing/playwright` sign-in helper
 *    against a Clerk **test instance**. The persona-specific seed users
 *    (`<persona>@example.com`) and their shared password live in the
 *    Clerk dashboard; this module owns the persona ↔ identifier ↔ role
 *    mapping and nothing else.
 *
 * Per docs/architecture.md §1 the auth provider is Clerk
 * (`@clerk/astro` at MVP). The seam keeps the persona ↔ role mapping
 * documented at one place (this file) so the Gherkin step
 * `Given I am signed in as {string}` and the per-persona Playwright
 * projects (`apps/web/playwright.config.ts`) resolve identically.
 */

import { clerk } from '@clerk/testing/playwright';
import type { Page } from '@playwright/test';

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
// Acceptance-tier seam (refactored — Story #371)
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
 * RBAC role the persona carries inside the application. Mirrors the
 * canonical role enum in `packages/shared/src/rbac/types.ts`.
 */
export type PersonaRole = 'dev_admin' | 'org_admin' | 'team_admin' | 'member';

/**
 * Static record bound to each persona. The seeded Clerk test-instance
 * users (`<persona>@example.com`) live in the Clerk dashboard — this
 * module is the single source of truth for the persona ↔ identifier ↔
 * role mapping consumed by acceptance scenarios.
 *
 * `clerkSubjectId` is the deterministic stub the contract-tier
 * middleware recognises; the acceptance tier does not consult it
 * (Clerk owns the real `sub` claim once `clerk.signIn` runs).
 *
 * Emails use the `@example.com` synthetic domain (RFC 2606 reserved
 * for documentation). Clerk rejects the `.invalid` TLD at the
 * validation boundary so the contract-tier synthetic-PII guard
 * (`safety.ts`, which still pins `.invalid` for DB seeds) and the
 * acceptance-tier persona identifiers intentionally diverge.
 */
export interface PersonaFixture {
  readonly persona: Persona;
  readonly email: string;
  readonly clerkSubjectId: string;
  readonly role: PersonaRole | null;
  readonly orgId: string | null;
  readonly teamId: string | null;
}

export const PERSONA_FIXTURES: Readonly<Record<Persona, PersonaFixture>> = Object.freeze({
  anonymous: Object.freeze({
    persona: 'anonymous',
    email: 'anonymous@example.com',
    clerkSubjectId: 'user_test_anonymous',
    role: null,
    orgId: null,
    teamId: null,
  }),
  athlete: Object.freeze({
    persona: 'athlete',
    email: 'athlete@example.com',
    clerkSubjectId: 'user_test_athlete',
    role: 'member',
    orgId: null,
    teamId: null,
  }),
  coach: Object.freeze({
    persona: 'coach',
    email: 'coach@example.com',
    clerkSubjectId: 'user_test_coach',
    role: 'team_admin',
    orgId: 'org_test_a',
    teamId: 'team_test_a_1',
  }),
  'org-admin': Object.freeze({
    persona: 'org-admin',
    email: 'org-admin@example.com',
    clerkSubjectId: 'user_test_org_admin',
    role: 'org_admin',
    orgId: 'org_test_a',
    teamId: null,
  }),
  'dev-admin': Object.freeze({
    persona: 'dev-admin',
    email: 'dev-admin@example.com',
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

/**
 * Read the shared seed-user password from the environment. All four
 * Clerk test-instance users share the same password so a single secret
 * rotation covers the whole acceptance tier — see
 * `docs/patterns.md` § _Authenticated test sessions_ for the rotation
 * runbook.
 *
 * Throws if missing so a forgotten environment variable fails the run
 * fast rather than silently attempting a sign-in with an empty
 * password.
 */
export function requireTestUserPassword(): string {
  const password = process.env.CLERK_TEST_USER_PASSWORD;
  if (!password || typeof password !== 'string') {
    throw new Error(
      'signInAs: CLERK_TEST_USER_PASSWORD is not set. ' +
        'Set it to the password shared by the seeded Clerk test-instance users ' +
        '(athlete@example.com, coach@example.com, org-admin@example.com, ' +
        'dev-admin@example.com). See docs/patterns.md § Authenticated test sessions.',
    );
  }
  return password;
}

/**
 * Parameters for `signInAs`. Mirrors `@clerk/testing/playwright`'s
 * `clerk.signIn` shape — a live Playwright `Page` is required because
 * Clerk's helper drives sign-in through the client SDK on a real page
 * that has already loaded Clerk.
 */
export interface SignInAsParams {
  readonly page: Page;
  readonly persona: Persona;
}

/**
 * Acceptance-tier sign-in entry point. Drives Clerk's official
 * Playwright testing helper end-to-end:
 *
 *   1. Resolves the persona to its seeded email identifier.
 *   2. Reads the shared `CLERK_TEST_USER_PASSWORD` env var.
 *   3. Calls `clerk.signIn({ page, signInParams: { strategy: 'password', ... } })`,
 *      which sets up the Clerk testing token and completes a real
 *      first-factor sign-in against the test instance.
 *
 * The caller is responsible for navigating `page` to a route that
 * loads Clerk **before** calling `signInAs` (per Clerk's API contract).
 * In step definitions this is typically the welcome / sign-in surface.
 *
 * `signInAs({ page, persona: 'anonymous' })` is a no-op — the
 * "anonymous" persona has no session. Unknown personas throw at
 * `resolvePersona` long before this function runs.
 */
export async function signInAs({ page, persona }: SignInAsParams): Promise<void> {
  if (persona === 'anonymous') {
    return;
  }
  const fixture = PERSONA_FIXTURES[persona];
  if (!fixture) {
    throw new TypeError(`signInAs: unknown persona ${JSON.stringify(persona)}`);
  }
  const password = requireTestUserPassword();
  await clerk.signIn({
    page,
    signInParams: {
      strategy: 'password',
      identifier: fixture.email,
      password,
    },
  });
}
