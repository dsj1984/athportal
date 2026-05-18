/**
 * Playwright `globalSetup` hook for the per-persona storageState cache.
 *
 * Runs once per Playwright invocation (before any worker starts). Calls
 * the shared seam to mint a Clerk testing-token session for every MVP
 * persona and writes it to `apps/web/playwright-output/storage/<persona>.json`.
 *
 * The per-persona Playwright projects in `playwright.config.ts` then
 * point their `storageState` at the file this hook produces, so every
 * scenario tagged for that project resumes the cached session without
 * touching the Clerk UI.
 *
 * The `CLERK_TESTING_TOKEN_SIGNING_KEY` env var is operator-owned (per
 * docs/patterns.md § Authenticated test sessions). When it is absent —
 * e.g., a PR pipeline that has not yet been wired with the secret, or a
 * local run by a contributor without the test instance — global setup
 * skips minting and logs a one-line warning. Any scenario that actually
 * requires a persona session will fail downstream when its project tries
 * to load the missing `storageState`; the persona-required scenarios in
 * `tests/features/identity/auth/**` are all tagged `@pending` at MVP
 * (the web UI surfaces land in later Epics) and are excluded by the
 * playwright-bdd `tags: 'not @pending'` filter, so the skip is safe.
 */
import { ensureAllPersonaStorage } from './persona-storage';

export default async function globalSetup(): Promise<void> {
  if (!process.env.CLERK_TESTING_TOKEN_SIGNING_KEY) {
    console.warn(
      '[persona-global-setup] CLERK_TESTING_TOKEN_SIGNING_KEY is not set — ' +
        'skipping per-persona storageState mint. Persona-required scenarios ' +
        'will fail if any are selected; @pending scenarios are unaffected.',
    );
    return;
  }
  await ensureAllPersonaStorage();
}
