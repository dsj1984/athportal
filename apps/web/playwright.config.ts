import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';
import { cucumberReporter, defineBddConfig } from 'playwright-bdd';

/**
 * Playwright + playwright-bdd config for the web acceptance tier.
 *
 * - `features` points one workspace up to the repo-root corpus at
 *   `tests/features/**` so the same `.feature` files can later be bound by
 *   the v1.0 mobile (Detox) runner without moving files.
 * - `steps` resolves to this workspace's step library under `e2e/steps/`.
 * - Two MVP projects today: a desktop `anonymous` project and an
 *   emulated `chromium-mobile-pwa` viewport. Per-persona projects
 *   (`athlete`, `coach`, `org-admin`, `dev-admin`) are deferred to
 *   GitHub Issue #371 (refactor of the test-auth seam to
 *   `@clerk/testing/playwright`). Until that lands, the 11
 *   persona-required scenarios under `tests/features/identity/**`
 *   stay `@pending`-tagged and never reach the runner.
 * - The Cucumber JSON reporter writes to `apps/web/test-results/cucumber.json`
 *   so CI can upload it as a stable artifact path.
 *
 * Tag filtering for CI tiers is applied at invocation time via Playwright's
 * `--grep` flag (e.g., `--grep @smoke` for the PR pipeline).
 */
// Resolve config-relative paths to absolute so tools that re-evaluate this
// file from a different cwd (knip's plugin scan on POSIX CI, monorepo
// task runners) don't see `../../tests/features` resolved against their
// own working directory and trip playwright-bdd's startup `featuresRoot`
// validator. The relative form worked on Windows but failed knip:strict
// in CI on Linux after Story #310 wired the gate up.
const here = path.dirname(fileURLToPath(import.meta.url));
const testDir = defineBddConfig({
  featuresRoot: path.resolve(here, '../../tests/features'),
  steps: ['./e2e/steps/**/*.ts'],
  outputDir: '.bdd-gen',
  // Skip scenarios tagged @pending so bddgen does not fail compilation
  // on features-first scaffolds whose step definitions have not landed
  // yet. Remove the tag from a scenario once its matching step library
  // lands; the scenario then generates and runs on the next CI cycle.
  tags: 'not @pending',
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
    // The default project — no `storageState`, no cached session. Every
    // un-tagged scenario runs here and starts anonymous.
    {
      name: 'anonymous',
      use: { ...devices['Desktop Chrome'] },
    },
    // Mobile PWA viewport — retained from Epic #4. Runs the same
    // scenarios as `anonymous` against an emulated Pixel 7.
    {
      name: 'chromium-mobile-pwa',
      use: { ...devices['Pixel 7'] },
    },
  ],
});
