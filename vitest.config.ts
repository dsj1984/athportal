import { defineConfig } from 'vitest/config';

// Root-level Vitest config used by `pnpm run test:coverage`. It picks up every
// workspace's `src/**/*.test.ts` and emits a single merged coverage report at
// `coverage/coverage-final.json` so the story-close validation chain can read
// a unified artifact regardless of how many workspaces exist.
export default defineConfig({
  test: {
    include: ['apps/**/src/**/*.test.ts', 'packages/**/src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary'],
      reportsDirectory: 'coverage',
      include: ['apps/**/src/**/*.ts', 'packages/**/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/dist/**', '**/node_modules/**'],
    },
  },
});
