import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';
import { cucumberReporter, defineBddConfig } from 'playwright-bdd';
import { personaStoragePath } from './e2e/fixtures/persona-storage';

/**
 * Playwright + playwright-bdd config for the web acceptance tier.
 *
 * - `features` points one workspace up to the repo-root corpus at
 *   `tests/features/**` so the same `.feature` files can later be bound by
 *   the v1.0 mobile (Detox) runner without moving files.
 * - `steps` resolves to this workspace's step library under `e2e/steps/`.
 * - One Playwright project per MVP persona (`anonymous`, `athlete`,
 *   `coach`, `org-admin`, `dev-admin`). Each persona project (other than
 *   `anonymous`) loads its `storageState` from a cached fixture under
 *   `apps/web/playwright-output/storage/<persona>.json` that the global
 *   setup hook mints once per Playwright invocation via the shared
 *   `signInAs(persona)` seam.
 * - The Cucumber JSON reporter writes to `apps/web/test-results/cucumber.json`
 *   so CI can upload it as a stable artifact path.
 *
 * Tag filtering for CI tiers is applied at invocation time via Playwright's
 * `--grep` flag (e.g., `--grep @smoke` for the PR pipeline). Scenarios
 * pick their persona project via `--project=<persona>`.
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

// The per-persona projects are only useful when the operator-owned
// `CLERK_TESTING_TOKEN_SIGNING_KEY` secret is wired (per docs/patterns.md
// § Authenticated test sessions). When absent, the global setup short-
// circuits and the persona `storageState` files never exist — we MUST NOT
// register projects that point at missing files, because Playwright fails
// on the first scenario each project tries to load (even when the project
// matches zero scenarios after `--grep` filtering). Each persona project
// is also gated to its own `@persona-<name>` tag so the legacy
// foundation-web-acceptance-smoke scenarios only run on `anonymous`.
const HAS_TESTING_TOKEN = Boolean(process.env.CLERK_TESTING_TOKEN_SIGNING_KEY);

const personaProjects = HAS_TESTING_TOKEN
  ? [
      {
        name: 'athlete',
        grep: /@persona-athlete/,
        use: {
          ...devices['Desktop Chrome'],
          storageState: personaStoragePath('athlete'),
        },
      },
      {
        name: 'coach',
        grep: /@persona-coach/,
        use: {
          ...devices['Desktop Chrome'],
          storageState: personaStoragePath('coach'),
        },
      },
      {
        name: 'org-admin',
        grep: /@persona-org-admin/,
        use: {
          ...devices['Desktop Chrome'],
          storageState: personaStoragePath('org-admin'),
        },
      },
      {
        name: 'dev-admin',
        grep: /@persona-dev-admin/,
        use: {
          ...devices['Desktop Chrome'],
          storageState: personaStoragePath('dev-admin'),
        },
      },
    ]
  : [];

export default defineConfig({
  testDir,
  fullyParallel: true,
  // Playwright clears `outputDir` before every run; keep per-test artifacts
  // (screenshots, traces) in `playwright-output/` so `test-results/` stays
  // a stable destination for the Cucumber JSON report consumed by CI.
  outputDir: 'playwright-output',
  // Mint the per-persona storage-state cache once per invocation, before
  // any worker starts. The hook delegates to the shared `signInAs` seam.
  globalSetup: path.resolve(here, './e2e/fixtures/persona-global-setup.ts'),
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
    ...personaProjects,
    // Mobile PWA viewport — retained from Epic #4. Runs the same
    // scenarios as `anonymous` against an emulated Pixel 7.
    {
      name: 'chromium-mobile-pwa',
      use: { ...devices['Pixel 7'] },
    },
  ],
});
