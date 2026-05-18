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
 */
import { ensureAllPersonaStorage } from './persona-storage';

export default async function globalSetup(): Promise<void> {
  await ensureAllPersonaStorage();
}
