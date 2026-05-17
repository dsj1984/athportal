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
  featuresRoot: '../../tests/features',
  steps: ['./e2e/steps/**/*.ts'],
  outputDir: '.bdd-gen',
});

const E2E_PORT = Number(process.env.E2E_PORT ?? 4317);
const E2E_BASE_URL = `http://127.0.0.1:${E2E_PORT}`;

export default defineConfig({
  testDir,
  fullyParallel: true,
  // Playwright clears `outputDir` before every run; keep per-test artifacts
  // (screenshots, traces) in `playwright-output/` so `test-results/` stays
  // a stable destination for the Cucumber JSON report consumed by CI.
  outputDir: 'playwright-output',
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
    cucumberReporter('json', { outputFile: 'test-results/cucumber.json' }),
  ],
  use: {
    baseURL: E2E_BASE_URL,
  },
  webServer: {
    command: `node e2e/fixtures/static-server.mjs`,
    url: E2E_BASE_URL,
    reuseExistingServer: !process.env.CI,
    env: { PORT: String(E2E_PORT) },
    stdout: 'pipe',
    stderr: 'pipe',
  },
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
