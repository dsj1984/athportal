import { defineConfig, mergeConfig } from 'vitest/config';
import { vitestBaseConfig } from '@repo/config/vitest-base';

/**
 * @repo/baselines is a Node-only utility package — the read/write/compare/
 * format harness consumed by the seven dimension scripts. It does not ship
 * any React surface, so the unit tier runs under `node` rather than jsdom.
 */
export default mergeConfig(
  vitestBaseConfig,
  defineConfig({
    test: {
      include: ['src/**/*.test.ts'],
      exclude: ['**/dist/**', '**/node_modules/**'],
    },
  }),
);
