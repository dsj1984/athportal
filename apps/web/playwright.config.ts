import { defineConfig, devices } from '@playwright/test';
import { cucumberReporter, defineBddConfig } from 'playwright-bdd';

/**
 * Playwright + playwright-bdd config for the web acceptance tier.
 *
 * - `features` points one workspace up to the repo-root corpus at
 *   `tests/features/**` so the same `.feature` files can later be bound by
 *   the v1.0 mobile (Detox) runner without moving files.
 * - `steps` resolves to this workspace's step library under `e2e/steps/`.
 * - Two browser projects exercise the same generated tests: a desktop
 *   Chromium viewport and an emulated Pixel 7 (mobile PWA) viewport.
 * - The Cucumber JSON reporter writes to `apps/web/test-results/cucumber.json`
 *   so CI can upload it as a stable artifact path.
 *
 * Tag filtering for CI tiers is applied at invocation time via Playwright's
 * `--grep` flag (e.g., `--grep @smoke` for the PR pipeline).
 */
const testDir = defineBddConfig({
  features: ['../../tests/features/**/*.feature'],
  steps: ['./e2e/steps/**/*.ts'],
  outputDir: '.bdd-gen',
});

export default defineConfig({
  testDir,
  fullyParallel: true,
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
    cucumberReporter('json', { outputFile: 'test-results/cucumber.json' }),
  ],
  projects: [
    {
      name: 'chromium-desktop',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'chromium-mobile-pwa',
      use: { ...devices['Pixel 7'] },
    },
  ],
});
