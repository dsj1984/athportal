import { defineConfig, mergeConfig } from 'vitest/config';
import { vitestBaseConfig } from '@repo/config/vitest-base';

export default mergeConfig(
  vitestBaseConfig,
  defineConfig({
    test: {
      include: ['src/**/*.test.{ts,tsx}'],
      exclude: ['**/*.contract.test.{ts,tsx}', '**/dist/**', '**/node_modules/**'],
    },
  }),
);
