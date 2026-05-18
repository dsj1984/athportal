/**
 * Authentication step library.
 *
 * Owns Given/When phrases that put the runner into a known sign-in state
 * (anonymous visitor, signed-in user with a given role, signed-out
 * mid-session). Downstream Epics extend this file as new sign-in paths land
 * (magic link, OAuth, etc.).
 *
 * Step authoring rules — no DOM selectors, no URL literals, no HTTP status
 * codes inside step bodies — live in
 * `.agents/rules/gherkin-standards.md` and `docs/testing-strategy.md`.
 */
import { resolvePersona, signInAs } from '@repo/shared/testing';
import { createBdd } from 'playwright-bdd';

const { Given } = createBdd();

Given('I am a first-time visitor to the public welcome page', async () => {
  // No-op at this Epic: a first-time visitor needs no pre-arranged state.
  // The `When I open the welcome page` step performs the navigation.
  // Downstream Epics may clear cookies / storage here when sign-in seeds
  // server state across runs.
});

/**
 * Canonical sign-in step for the test-auth seam (Story #371).
 *
 * Resolves the persona label (`'athlete'`, `'coach'`, `'org admin'`,
 * `'dev admin'`) via `resolvePersona`, navigates the page to a route
 * that loads Clerk (Clerk's testing helper requires it), and drives a
 * real first-factor sign-in against the Clerk test instance via
 * `@clerk/testing/playwright`'s `clerk.signIn`. The shared seam at
 * `packages/shared/src/testing/auth.ts` owns the persona ↔ identifier
 * ↔ role mapping — there is no dev-only auth bypass in this step body.
 *
 * Unknown labels surface as a `TypeError` from `resolvePersona` so a
 * scenario typo fails loudly rather than silently signing in as the
 * wrong persona.
 */
Given('I am signed in as {string}', async ({ page }, personaLabel: string) => {
  const fixture = resolvePersona(personaLabel);
  if (fixture.persona === 'anonymous') return;
  await page.goto('/');
  await signInAs({ page, persona: fixture.persona });
});

/**
 * Canonical signed-out baseline. Clears any session cookie planted by a
 * prior step (or by a cached persona `storageState`) so the scenario
 * starts from a known anonymous baseline.
 */
Given('I am not signed in', async ({ context }) => {
  await context.clearCookies();
});
