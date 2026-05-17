import { defineConfig } from 'vitest/config';

// Root-level Vitest config used by `pnpm run test:coverage`. It picks up every
// workspace's unit tests and emits a single merged coverage report at
// `coverage/coverage-final.json` so the story-close validation chain can read
// a unified artifact regardless of how many workspaces exist.
//
// Pyramid tier scope: unit. Contract tests (`*.contract.test.{ts,tsx}`) are
// excluded here — they run via apps/api's dedicated contract config once
// Story #170 lands.
export default defineConfig({
  test: {
    include: [
      'apps/**/src/**/*.test.{ts,tsx}',
      'packages/**/src/**/*.test.{ts,tsx}',
    ],
    exclude: [
      '**/*.contract.test.{ts,tsx}',
      '**/dist/**',
      '**/node_modules/**',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary'],
      reportsDirectory: 'coverage',
      include: ['apps/**/src/**/*.ts', 'packages/**/src/**/*.ts'],
      exclude: [
        '**/*.test.{ts,tsx}',
        '**/dist/**',
        '**/node_modules/**',
      ],
    },
  },
});
