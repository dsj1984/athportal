import { fileURLToPath } from 'node:url';
import { vitestBaseConfig } from '@repo/config/vitest-base';
import { defineConfig, mergeConfig } from 'vitest/config';

/**
 * apps/web Vitest config — declares both `web-unit` and `web-contract`
 * projects so `pnpm --filter @repo/web exec vitest run` exercises both
 * tiers in isolation, mirroring the root `vitest.workspace.ts`.
 *
 * apps/web's contract tier is reserved for adapter/boundary tests; today
 * no contract tests live here, but the project is declared so adding one
 * is a no-config-change operation.
 *
 * `astro:middleware` is a virtual module resolved by the Astro runtime
 * (not by Vitest's loader). Aliasing it to the real backing file
 * (`astro/dist/virtual-modules/middleware.js`) lets Vitest load
 * `apps/web/src/middleware.ts` without spinning up Astro — landed by
 * Story #562 / Task #573 so the onboarding-gate allowlist matrix can be
 * exercised as a pure-function unit test.
 */
const astroMiddlewareShim = fileURLToPath(
  new URL('./src/testing/astro-middleware-shim.ts', import.meta.url),
);

export default mergeConfig(
  vitestBaseConfig,
  defineConfig({
    test: {
      projects: [
        {
          extends: false,
          resolve: {
            alias: {
              'astro:middleware': astroMiddlewareShim,
            },
          },
          test: {
            name: 'web-unit',
            environment: 'node',
            globals: false,
            include: ['src/**/*.test.{ts,tsx}'],
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
