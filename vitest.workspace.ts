import { defineConfig } from 'vitest/config';
import { vitestBaseConfig } from './packages/config/vitest.base';

/**
 * Root Vitest workspace config — declares the pyramid's projects.
 *
 * Two unit projects are declared so component tests (which import
 * `@testing-library/react` and need a DOM) run under jsdom while pure
 * logic tests stay on the faster node env.
 *
 * The `contract` project mirrors the per-workspace `api-contract`
 * project in `apps/api/vitest.config.ts` so the merged coverage report
 * produced by `pnpm run test:coverage` captures route-level coverage.
 * Without this project the merged coverage rollup classified every
 * route handler as "untested" even when contract tests exercised it
 * end-to-end (the per-workspace `pnpm --filter @repo/api exec vitest run`
 * path always covered them; this project closes the merged-path gap).
 *
 * Workspaces still ship their own `vitest.config.ts` that extends the
 * shared base so `pnpm --filter @repo/<name> exec vitest run` continues
 * to work in isolation.
 */
export default defineConfig({
  ...vitestBaseConfig,
  test: {
    ...vitestBaseConfig.test,
    projects: [
      {
        extends: false,
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
