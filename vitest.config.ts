import { defineConfig } from 'vitest/config';

// Root-level Vitest config used by `pnpm run test:coverage`. It picks up every
// workspace's unit tests and emits a single merged coverage report at
// `coverage/coverage-final.json` so the story-close validation chain can read
// a unified artifact regardless of how many workspaces exist.
//
// Pyramid tier scope: unit. Contract tests (`*.contract.test.{ts,tsx}`) are
// excluded here — they run via apps/api's dedicated contract config once
// Story #170 lands.
//
// Two projects are declared so `.tsx` component tests run under jsdom while
// pure-logic `.ts` tests stay on the faster node env. This mirrors the
// per-workspace `vitest.config.ts` choice made by `@repo/shared`.
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
          name: 'scripts',
          environment: 'node',
          globals: false,
          include: ['scripts/__tests__/**/*.test.mjs'],
          exclude: ['**/dist/**', '**/node_modules/**'],
        },
      },
    ],
  },
});
