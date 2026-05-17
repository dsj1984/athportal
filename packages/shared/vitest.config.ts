import react from '@vitejs/plugin-react';
import { defineConfig, mergeConfig } from 'vitest/config';
import { vitestBaseConfig } from '@repo/config/vitest-base';

// @repo/shared hosts cross-stack helpers, including React-component examples,
// so this workspace runs under jsdom rather than the base `node` env.
export default mergeConfig(
  vitestBaseConfig,
  defineConfig({
    plugins: [react()],
    test: {
      environment: 'jsdom',
      include: ['src/**/*.test.{ts,tsx}'],
      exclude: ['**/*.contract.test.{ts,tsx}', '**/dist/**', '**/node_modules/**'],
    },
  }),
);
