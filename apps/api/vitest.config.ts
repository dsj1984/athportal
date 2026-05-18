import { vitestBaseConfig } from '@repo/config/vitest-base';
import { defineConfig, mergeConfig } from 'vitest/config';

/**
 * apps/api Vitest config — declares both `api-unit` and `api-contract`
 * projects so `pnpm --filter @repo/api exec vitest run` exercises both
 * tiers in isolation, mirroring the root `vitest.workspace.ts`.
 */
export default mergeConfig(
  vitestBaseConfig,
  defineConfig({
    test: {
      projects: [
        {
          extends: false,
          test: {
            name: 'api-unit',
            environment: 'node',
            globals: false,
            include: ['src/**/*.test.{ts,tsx}'],
            exclude: ['**/*.contract.test.{ts,tsx}', '**/dist/**', '**/node_modules/**'],
          },
        },
        {
          extends: false,
          test: {
            name: 'api-contract',
            environment: 'node',
            globals: false,
            include: ['src/**/*.contract.test.{ts,tsx}'],
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
  }),
);
