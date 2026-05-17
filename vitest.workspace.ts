import { defineConfig } from 'vitest/config';
import { vitestBaseConfig } from './packages/config/vitest.base';

/**
 * Root Vitest workspace config — declares the pyramid's unit project.
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
          include: [
            'apps/**/src/**/*.test.{ts,tsx}',
            'packages/**/src/**/*.test.{ts,tsx}',
          ],
          exclude: [
            '**/*.contract.test.{ts,tsx}',
            '**/dist/**',
            '**/node_modules/**',
          ],
        },
      },
    ],
  },
});
