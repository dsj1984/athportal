/**
 * Authentication step library.
 *
 * Owns Given/When phrases that put the runner into a known sign-in state
 * (anonymous visitor, signed-in user with a given role, signed-out
 * mid-session). Downstream Epics extend this file as new sign-in paths land
 * (Clerk session, magic link, etc.).
 *
 * Step authoring rules — no DOM selectors, no URL literals, no HTTP status
 * codes inside step bodies — live in
 * `.agents/rules/gherkin-standards.md` and `docs/testing-strategy.md`.
 */
import { resolvePersona, sessionCookieFor } from '@repo/shared/testing';
import { createBdd } from 'playwright-bdd';

const { Given } = createBdd();

Given('I am a first-time visitor to the public welcome page', async () => {
  // No-op at this Epic: a first-time visitor needs no pre-arranged state.
  // The `When I open the welcome page` step performs the navigation.
  // Downstream Epics may clear cookies / storage here when sign-in seeds
  // server state across runs.
});

/**
 * Canonical sign-in step for the test-auth seam (Story #329).
 *
 * Resolves the persona label (`'athlete'`, `'coach'`, `'org admin'`,
 * `'dev admin'`) via `resolvePersona`, mints a real Clerk testing-token
 * session for that persona, and plants the `__session` cookie on the
 * browser context. The shared seam at `packages/shared/src/testing/auth.ts`
 * is the single source of truth for persona ↔ role mapping — there is no
 * dev-only auth bypass in this step body.
 *
 * Unknown labels surface as a `TypeError` from `resolvePersona` so a
 * scenario typo fails loudly rather than silently signing in as the
 * wrong persona.
 */
Given('I am signed in as {string}', async ({ context }, personaLabel: string) => {
  const fixture = resolvePersona(personaLabel);
  const cookie = await sessionCookieFor(fixture.persona);
  await context.addCookies([cookie]);
});

/**
 * Canonical signed-out baseline. Clears any session cookie planted by a
 * prior step (or by a cached persona `storageState`) so the scenario
 * starts from a known anonymous baseline.
 */
Given('I am not signed in', async ({ context }) => {
  await context.clearCookies();
});
