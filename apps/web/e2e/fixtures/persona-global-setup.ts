/**
 * Playwright `globalSetup` hook for the per-persona storageState cache.
 *
 * Runs once per Playwright invocation (before any worker starts). For
 * each non-anonymous persona, this hook:
 *
 *   1. Calls `clerkSetup()` once to mint the Clerk testing token.
 *   2. Opens a fresh browser context, navigates to a page that loads
 *      Clerk, and drives `signInAs({ page, persona })` against the
 *      Clerk test instance using the seeded user credentials.
 *   3. Persists the resulting `storageState` to
 *      `apps/web/playwright-output/storage/<persona>.json` so the
 *      per-persona Playwright projects resume the session without
 *      re-signing-in per scenario.
 *
 * `CLERK_TEST_USER_PASSWORD` (the shared seed-user password) and
 * `CLERK_SECRET_KEY` (the test-instance secret key required by
 * `clerk.signIn`'s ticket strategy) are operator-owned. When either is
 * absent — fork PR, brand-new contributor, or a CI pipeline before the
 * secret has been wired — this hook short-circuits with a one-line
 * warning. The per-persona Playwright projects in `playwright.config.ts`
 * are gated on the same env vars and are omitted entirely in that case,
 * so no scenario tries to load a missing storageState.
 *
 * The persona-required scenarios in `tests/features/identity/auth/**`
 * remain `@pending`-tagged at MVP (Story #371 ships the seam without
 * the matching persona surfaces) and are filtered out by playwright-bdd's
 * `tags: 'not @pending'`, so the skip is safe.
 */
import { mkdirSync } from 'node:fs';
import { clerkSetup } from '@clerk/testing/playwright';
import { type FullConfig, chromium } from '@playwright/test';
import { signInAs } from '@repo/shared/testing';
import { PERSONA_PROJECT_KEYS, PERSONA_STORAGE_DIR, personaStoragePath } from './persona-storage';

export default async function globalSetup(config: FullConfig): Promise<void> {
  if (process.env.CLERK_TEST_PERSONAS_READY !== '1') {
    // The persona-specific protected web surfaces are not live yet
    // (Issue #383 tracks the surface-by-surface lift). The Playwright
    // webServer is still a static-HTML placeholder with no Clerk JS,
    // so attempting `clerk.signIn` would fail with "Clerk not loaded".
    // Operator opt-in: set CLERK_TEST_PERSONAS_READY=1 once the real
    // Astro web app with @clerk/astro is the webServer target.
    return;
  }
  if (!process.env.CLERK_TEST_USER_PASSWORD || !process.env.CLERK_SECRET_KEY) {
    console.warn(
      '[persona-global-setup] CLERK_TEST_PERSONAS_READY=1 but ' +
        'CLERK_TEST_USER_PASSWORD and/or CLERK_SECRET_KEY are unset — ' +
        'skipping per-persona storageState mint. Persona-required scenarios ' +
        'will be excluded by the per-persona project gate.',
    );
    return;
  }

  await clerkSetup();
  mkdirSync(PERSONA_STORAGE_DIR, { recursive: true });

  // The first project's baseURL is the live web server Playwright will
  // boot via `webServer`. We launch one Chromium browser, reuse it
  // across personas, and seed each persona's storageState file.
  const baseURL = config.projects[0]?.use?.baseURL;
  if (!baseURL) {
    throw new Error(
      '[persona-global-setup] Expected the default project to declare a baseURL. ' +
        'Refusing to mint persona storage state without a target origin.',
    );
  }

  const browser = await chromium.launch();
  try {
    for (const persona of PERSONA_PROJECT_KEYS) {
      const target = personaStoragePath(persona);
      if (!target) continue;
      const context = await browser.newContext({ baseURL });
      const page = await context.newPage();
      try {
        await page.goto('/');
        await signInAs({ page, persona });
        await context.storageState({ path: target });
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}
