import { defineConfig, mergeConfig } from 'vitest/config';
import { vitestBaseConfig } from '@repo/config/vitest-base';

/**
 * apps/web Vitest config — declares both `web-unit` and `web-contract`
 * projects so `pnpm --filter @repo/web exec vitest run` exercises both
 * tiers in isolation, mirroring the root `vitest.workspace.ts`.
 *
 * apps/web's contract tier is reserved for adapter/boundary tests; today
 * no contract tests live here, but the project is declared so adding one
 * is a no-config-change operation.
 */
export default mergeConfig(
  vitestBaseConfig,
  defineConfig({
    test: {
      projects: [
        {
          extends: false,
          test: {
            name: 'web-unit',
            environment: 'node',
            globals: false,
            include: ['src/**/*.test.{ts,tsx}'],
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
            name: 'web-contract',
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
