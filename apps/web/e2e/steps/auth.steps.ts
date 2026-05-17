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
import { createBdd } from 'playwright-bdd';

const { Given } = createBdd();

Given('I am a first-time visitor to the public welcome page', async () => {
  // No-op at this Epic: a first-time visitor needs no pre-arranged state.
  // The `When I open the welcome page` step performs the navigation.
  // Downstream Epics may clear cookies / storage here when sign-in seeds
  // server state across runs.
});
