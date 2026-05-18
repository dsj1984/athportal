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
import { resolvePersona } from '@repo/shared/testing';
import { createBdd } from 'playwright-bdd';

const { Given } = createBdd();

Given('I am a first-time visitor to the public welcome page', async () => {
  // No-op at this Epic: a first-time visitor needs no pre-arranged state.
  // The `When I open the welcome page` step performs the navigation.
  // Downstream Epics may clear cookies / storage here when sign-in seeds
  // server state across runs.
});

/**
 * Canonical sign-in step — phrase contract preserved across the refactor.
 *
 * The body currently throws because the underlying seam at
 * `packages/shared/src/testing/auth.ts` is deferred pending Issue #371
 * (rewrite to `@clerk/testing/playwright`'s `clerk.signIn` API). The
 * persona scenarios that consume this step in `tests/features/identity/**`
 * are all `@pending`-tagged so the throw is never reached in CI;
 * dropping a `@pending` tag without resolving #371 surfaces the throw
 * with a clear pointer to the rewrite.
 *
 * `resolvePersona` still runs first so a scenario typo continues to fail
 * loudly with the canonical "Accepted personas" message.
 */
Given('I am signed in as {string}', async (_, personaLabel: string) => {
  resolvePersona(personaLabel);
  throw new Error(
    `Given I am signed in as "${personaLabel}": the test-auth seam is deferred ` +
      'pending the refactor to @clerk/testing/playwright (see GitHub Issue #371). ' +
      'Persona-required scenarios must remain @pending-tagged until that issue resolves.',
  );
});

/**
 * Canonical signed-out baseline. Clears any session cookie a prior step
 * (or a cached persona `storageState`) may have planted so the scenario
 * starts from a known anonymous baseline.
 */
Given('I am not signed in', async ({ context }) => {
  await context.clearCookies();
});
