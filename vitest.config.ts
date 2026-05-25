import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Root-level Vitest config used by `pnpm run test:coverage`. It picks up every
// workspace's unit tests and emits a single merged coverage report at
// `coverage/coverage-final.json` so the story-close validation chain can read
// a unified artifact regardless of how many workspaces exist.
//
// Pyramid tier scope: unit + contract. The contract project mirrors the
// per-workspace `api-contract` project in `apps/api/vitest.config.ts` so the
// merged coverage report captures route-level coverage. Before Story #599
// wired this in, the merged coverage rollup classified every route handler
// as "untested" even when contract tests exercised it end-to-end (the
// per-workspace `pnpm --filter @repo/api exec vitest run` path always
// covered them; this project closes the merged-path gap).
//
// Two projects are declared so `.tsx` component tests run under jsdom while
// pure-logic `.ts` tests stay on the faster node env. This mirrors the
// per-workspace `vitest.config.ts` choice made by `@repo/shared`.
//
// `astro:middleware` virtual-module alias: `apps/web/src/middleware.ts`
// imports the Astro runtime virtual module which Vitest's loader cannot
// resolve. The per-workspace `apps/web/vitest.config.ts` aliases this
// to a backing shim (Story #562 / Task #573), but the root coverage run
// uses THIS config and would otherwise fail with
// `Cannot find package 'astro:middleware'`. Mirror the alias here so the
// merged coverage run executes the middleware unit tests under the same
// shim the workspace test does.
const astroMiddlewareShim = fileURLToPath(
  new URL('./apps/web/src/testing/astro-middleware-shim.ts', import.meta.url),
);

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary'],
      reportsDirectory: 'coverage',
      include: ['apps/**/src/**/*.ts', 'packages/**/src/**/*.ts'],
      exclude: ['**/*.test.{ts,tsx}', '**/dist/**', '**/node_modules/**'],
    },
    projects: [
      {
        extends: false,
        resolve: {
          alias: {
            'astro:middleware': astroMiddlewareShim,
          },
        },
        test: {
          name: 'unit',
          environment: 'node',
          globals: false,
          include: ['apps/**/src/**/*.test.ts', 'packages/**/src/**/*.test.ts'],
          exclude: ['**/*.contract.test.{ts,tsx}', '**/dist/**', '**/node_modules/**'],
        },
      },
      {
        extends: false,
        resolve: {
          alias: {
            'astro:middleware': astroMiddlewareShim,
          },
        },
        test: {
          name: 'unit-jsdom',
          environment: 'jsdom',
          globals: false,
          include: ['apps/**/src/**/*.test.tsx', 'packages/**/src/**/*.test.tsx'],
          exclude: ['**/*.contract.test.{ts,tsx}', '**/dist/**', '**/node_modules/**'],
        },
      },
      {
        extends: false,
        test: {
          name: 'scripts',
          environment: 'node',
          globals: false,
          include: [
            'scripts/__tests__/**/*.test.mjs',
            'scripts/migration-label-guard.test.mjs',
            'scripts/qa/**/*.test.ts',
            'scripts/qa/**/*.test.mjs',
          ],
          exclude: ['**/dist/**', '**/node_modules/**'],
        },
      },
      {
        extends: false,
        test: {
          name: 'contract',
          environment: 'node',
          globals: false,
          include: ['apps/**/src/**/*.contract.test.{ts,tsx}'],
          exclude: ['**/dist/**', '**/node_modules/**'],
          pool: 'forks',
          fileParallelism: true,
          isolate: true,
          hookTimeout: 30_000,
          testTimeout: 30_000,
        },
      },
    ],
  },
});
