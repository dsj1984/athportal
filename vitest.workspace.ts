import { defineConfig } from 'vitest/config';
import { vitestBaseConfig } from './packages/config/vitest.base';

/**
 * Root Vitest workspace config — declares the pyramid's unit project(s).
 *
 * Two unit projects are declared so component tests (which import
 * `@testing-library/react` and need a DOM) run under jsdom while pure
 * logic tests stay on the faster node env.
 *
 * Contract tests (`*.contract.test.ts`) are excluded here; they live in
 * their own future project (apps/api/**) once the contract tier lands
 * under Story #170.
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
          include: ['scripts/__tests__/**/*.test.mjs', 'scripts/migration-label-guard.test.mjs'],
          exclude: ['**/dist/**', '**/node_modules/**'],
        },
      },
    ],
  },
});
