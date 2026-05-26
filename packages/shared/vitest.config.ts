import { vitestBaseConfig } from '@repo/config/vitest-base';
import react from '@vitejs/plugin-react';
import { defineConfig, mergeConfig } from 'vitest/config';

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
      coverage: {
        provider: 'v8',
        reporter: ['text', 'json', 'json-summary'],
        reportsDirectory: 'coverage',
        // The redaction allowlist is the single trust boundary for log
        // egress (Epic #5 PRD AC-7, Story #256). Per-file ratchet floor
        // is ≥95% on every dimension; any future widening of the
        // allowlist that forgets to extend `redaction.test.ts` will
        // drop branch coverage below the threshold and fail CI.
        thresholds: {
          'src/observability/redaction.ts': {
            statements: 95,
            branches: 95,
            functions: 95,
            lines: 95,
          },
          // Story #327 (Epic #7): the RBAC policy module's
          // correctness is load-bearing for every protected route.
          // The unit suite walks the cartesian product of
          // (role, resource, action) and exercises every branch
          // of the scope/owner/last-admin predicates; pin the
          // floor at ≥95% so a future widening of the rules
          // table that forgets to extend `policy.test.ts` fails
          // CI rather than silently shipping uncovered branches.
          'src/rbac/**': {
            statements: 95,
            branches: 95,
            functions: 95,
            lines: 95,
          },
        },
      },
      projects: [
        {
          extends: false,
          test: {
            name: 'shared-unit',
            environment: 'jsdom',
            globals: false,
            include: ['src/**/*.test.{ts,tsx}'],
            exclude: ['**/*.contract.test.{ts,tsx}', '**/dist/**', '**/node_modules/**'],
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
        {
          extends: false,
          // Story #875 / Task #885 — the seed / reset CLI entrypoints are
          // `.mjs` (so plain `node` can execute them, mirroring the
          // scripts/seed-dev-admin.mjs precedent). Their unit tests live
          // alongside them under packages/shared/scripts/ and need their
          // own vitest project because the `shared-unit` project only
          // picks up `src/**/*.test.{ts,tsx}`.
          test: {
            name: 'shared-scripts',
            environment: 'node',
            globals: false,
            include: ['scripts/**/*.test.mjs'],
            exclude: ['**/dist/**', '**/node_modules/**'],
          },
        },
      ],
    },
  }),
);
