import react from '@vitejs/plugin-react';
import { defineConfig, mergeConfig } from 'vitest/config';
import { vitestBaseConfig } from '@repo/config/vitest-base';

/**
 * @repo/shared hosts cross-stack helpers, including React-component
 * examples, so this workspace runs under jsdom rather than the base
 * `node` env.
 *
 * Two projects are declared so `pnpm --filter @repo/shared exec vitest run`
 * exercises both unit and contract tiers in isolation, mirroring what the
 * root `vitest.workspace.ts` does at the monorepo level.
 */
export default mergeConfig(
  vitestBaseConfig,
  defineConfig({
    plugins: [react()],
    test: {
      projects: [
        {
          extends: false,
          test: {
            name: 'shared-unit',
            environment: 'jsdom',
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
            name: 'shared-contract',
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
