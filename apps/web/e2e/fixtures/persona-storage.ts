/**
 * Per-persona `storageState` cache for Playwright projects.
 *
 * Each Playwright project in `apps/web/playwright.config.ts` loads its
 * `storageState` from a JSON file under
 * `apps/web/playwright-output/storage/<persona>.json`. This module is
 * the single writer for those files — it calls into the shared
 * `signInAs(persona)` seam (Story #329, Task #348) to mint a real Clerk
 * testing-token session and persists the resulting `StorageState` so
 * the Playwright worker pool restores it for every scenario without
 * re-minting per scenario.
 *
 * The file is intentionally NOT a Playwright test file — it is consumed
 * by `playwright.config.ts` at project-resolution time (via
 * `storageState`'s callable form is unsupported in 1.60; we precompute
 * the file on first import) and by the optional `globalSetup` hook
 * `ensurePersonaStorage()` if a project chooses to refresh fixtures up
 * front.
 *
 * Stale cache files are safe to delete: the next call regenerates them.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Persona, StorageState } from '@repo/shared/testing';
import { signInAs } from '@repo/shared/testing';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Absolute path to the per-persona storage cache directory. Lives under
 * Playwright's per-run `outputDir` sibling so the existing cleanup
 * conventions cover it.
 */
export const PERSONA_STORAGE_DIR = path.resolve(here, '../../playwright-output/storage');

const PERSONA_PROJECT_KEYS: Persona[] = [
  'anonymous',
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

/**
 * Ensure the cache directory exists and the per-persona storage file is
 * present. If a cached file already exists and is readable, it is
 * reused; otherwise this function mints a fresh `StorageState` via the
 * shared seam and writes it to disk.
 *
 * Returns the absolute storage path (or `undefined` for anonymous).
 */
export async function ensurePersonaStorage(persona: Persona): Promise<string | undefined> {
  if (persona === 'anonymous') return undefined;
  const target = personaStoragePath(persona);
  if (!target) return undefined;
  mkdirSync(PERSONA_STORAGE_DIR, { recursive: true });
  try {
    // Re-use the cached state when it is non-empty and JSON-parseable.
    const raw = readFileSync(target, 'utf-8');
    const parsed = JSON.parse(raw) as StorageState;
    if (parsed?.cookies?.length) return target;
  } catch {
    // fall through to mint
  }
  const state = await signInAs(persona);
  writeFileSync(target, `${JSON.stringify(state, null, 2)}\n`, 'utf-8');
  return target;
}

/**
 * Generate every persona's `storageState` file in one pass. Intended for
 * a Playwright `globalSetup` entry that wants the cache warm before the
 * first worker starts. The default config does not call this — projects
 * lazily warm their own cache via `ensurePersonaStorage` on first use —
 * but exporting it keeps the option open without a second writer.
 */
export async function ensureAllPersonaStorage(): Promise<void> {
  for (const persona of PERSONA_PROJECT_KEYS) {
    await ensurePersonaStorage(persona);
  }
}
