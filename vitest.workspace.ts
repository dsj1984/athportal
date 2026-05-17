import { defineConfig } from 'vitest/config';
import { vitestBaseConfig } from './packages/config/vitest.base';

/**
 * Root Vitest workspace config — declares every project in the testing
 * pyramid that runs under `pnpm run test`.
 *
 * Projects:
 *   - `unit`      — pure logic (.test.ts) under node env.
 *   - `unit-jsdom` — component tests (.test.tsx) under jsdom so React
 *     Testing Library has a DOM.
 *   - `contract`   — boundary tests (.contract.test.ts) under node env
 *     with `pool: 'forks'` and `singleFork: false` so contract tests can
 *     run in parallel against isolated `freshDb()` handles.
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
          exclude: [
            '**/*.contract.test.{ts,tsx}',
            '**/dist/**',
            '**/node_modules/**',
          ],
        },
      },
      {
        extends: false,
        test: {
          name: 'unit-jsdom',
          environment: 'jsdom',
          globals: false,
          include: ['apps/**/src/**/*.test.tsx', 'packages/**/src/**/*.test.tsx'],
          exclude: [
            '**/*.contract.test.{ts,tsx}',
            '**/dist/**',
            '**/node_modules/**',
          ],
        },
      },
      {
        extends: false,
        test: {
          name: 'contract',
          environment: 'node',
          globals: false,
          include: [
            'apps/**/src/**/*.contract.test.{ts,tsx}',
            'packages/**/src/**/*.contract.test.{ts,tsx}',
          ],
          exclude: ['**/dist/**', '**/node_modules/**'],
          pool: 'forks',
          // Vitest 4 removed `poolOptions.forks.singleFork` — `singleFork:
          // false` (parallel) is now expressed by leaving
          // `fileParallelism` at its default of `true`. Pinning it here
          // keeps the contract project's parallel-safety intent explicit.
          fileParallelism: true,
          isolate: true,
          hookTimeout: 30_000,
          testTimeout: 30_000,
        },
      },
    ],
  },
});
