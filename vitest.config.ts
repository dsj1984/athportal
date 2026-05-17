import { defineConfig } from 'vitest/config';

// Root-level Vitest config used by `pnpm run test:coverage`. It picks up every
// workspace's tests and emits a single merged coverage report at
// `coverage/coverage-final.json` so the story-close validation chain can read
// a unified artifact regardless of how many workspaces exist.
//
// Three projects are declared:
//   - `unit`       — .test.ts under node env.
//   - `unit-jsdom` — .test.tsx under jsdom (React components).
//   - `contract`   — *.contract.test.{ts,tsx} under node env with
//     forked, non-singleFork pool config for parallel-safe DB isolation.
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
          // Vitest 4 removed `poolOptions.forks.singleFork`; `fileParallelism`
          // at its default of `true` is the new equivalent of `singleFork:
          // false`. Pin it explicitly so the contract project's parallel
          // contract stays visible.
          fileParallelism: true,
          isolate: true,
          hookTimeout: 30_000,
          testTimeout: 30_000,
        },
      },
    ],
  },
});
