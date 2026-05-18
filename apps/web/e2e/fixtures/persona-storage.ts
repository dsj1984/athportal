/**
 * Per-persona `storageState` cache for Playwright projects.
 *
 * Each non-anonymous Playwright project in
 * `apps/web/playwright.config.ts` loads its `storageState` from a JSON
 * file under `apps/web/playwright-output/storage/<persona>.json`. The
 * `globalSetup` hook in `persona-global-setup.ts` populates those files
 * by driving the canonical `@clerk/testing/playwright` sign-in helper
 * (via `signInAs`) inside a real browser context, then writing
 * `context.storageState()` to disk — exactly the pattern Clerk's docs
 * recommend for authenticated Playwright tests.
 *
 * Stale cache files are safe to delete: the next setup pass regenerates
 * them.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Persona } from '@repo/shared/testing';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Absolute path to the per-persona storage cache directory. Lives under
 * Playwright's per-run `outputDir` sibling so the existing cleanup
 * conventions cover it.
 */
export const PERSONA_STORAGE_DIR = path.resolve(here, '../../playwright-output/storage');

/**
 * The MVP persona-project keys, in the order `globalSetup` walks them.
 * `anonymous` is excluded — it has no session and no cached file.
 */
export const PERSONA_PROJECT_KEYS: ReadonlyArray<Exclude<Persona, 'anonymous'>> = [
  'athlete',
  'coach',
  'org-admin',
  'dev-admin',
];

/**
 * Return the absolute path to the storage-state file for a persona.
 * Suitable for inlining into `playwright.config.ts` as the project's
 * `storageState` value.
 *
 * Anonymous returns `undefined` — Playwright treats a missing
 * `storageState` as "no preloaded session", which is exactly what the
 * anonymous project needs.
 */
export function personaStoragePath(persona: Persona): string | undefined {
  if (persona === 'anonymous') return undefined;
  return path.join(PERSONA_STORAGE_DIR, `${persona}.json`);
}
