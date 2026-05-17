import type { UserConfig } from 'vitest/config';

/**
 * Shared Vitest base configuration for the unit tier.
 *
 * Workspaces extend this base via their own `vitest.config.ts` to inherit
 * pyramid-aware defaults (env, globals, coverage provider) while remaining
 * free to override include/exclude globs per workspace.
 *
 * Thresholds are intentionally permissive — the quality-baselines Epic
 * will tighten them once real production code lands.
 */
export const vitestBaseConfig: UserConfig = {
  test: {
    environment: 'node',
    globals: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary'],
      reportsDirectory: 'coverage',
      thresholds: {
        lines: 0,
        functions: 0,
        branches: 0,
        statements: 0,
      },
    },
  },
};

export default vitestBaseConfig;
