/**
 * Per-persona Playwright project descriptors.
 *
 * Extracted from `apps/web/playwright.config.ts` so the config file stays
 * within the ADR-019 maintainability floor (rollup `*` min ≥ 70). The
 * gate decision (whether to register the persona projects at all) lives
 * in this module too — the config file imports a single ready-to-spread
 * array.
 */

import { devices } from '@playwright/test';
import { personaStoragePath } from './persona-storage';

/**
 * Return the per-persona Playwright project list, or an empty array when
 * the operator has not opted into persona-required scenarios.
 *
 * Three env vars must be set for the projects to register:
 *   1. `CLERK_TEST_PERSONAS_READY='1'` — opt-in flag (Issue #383).
 *   2. `CLERK_TEST_USER_PASSWORD` — shared seed-user password.
 *   3. `CLERK_SECRET_KEY` — test-instance secret key.
 *
 * When any is absent, the global setup short-circuits and the persona
 * storageState files never exist; we MUST NOT register projects that
 * point at missing files because Playwright fails on the first scenario
 * each project tries to load (even when the project matches zero
 * scenarios after `--grep` filtering).
 */
export function personaProjects() {
  const ready = Boolean(
    process.env.CLERK_TEST_PERSONAS_READY === '1' &&
      process.env.CLERK_TEST_USER_PASSWORD &&
      process.env.CLERK_SECRET_KEY,
  );
  if (!ready) return [];
  return [
    {
      name: 'athlete',
      grep: /@persona-athlete/,
      use: { ...devices['Desktop Chrome'], storageState: personaStoragePath('athlete') },
    },
    {
      name: 'coach',
      grep: /@persona-coach/,
      use: { ...devices['Desktop Chrome'], storageState: personaStoragePath('coach') },
    },
    {
      name: 'org-admin',
      grep: /@persona-org-admin/,
      use: { ...devices['Desktop Chrome'], storageState: personaStoragePath('org-admin') },
    },
    {
      name: 'dev-admin',
      grep: /@persona-dev-admin/,
      use: { ...devices['Desktop Chrome'], storageState: personaStoragePath('dev-admin') },
    },
  ];
}
