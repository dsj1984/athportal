import { defineConfig, mergeConfig } from 'vitest/config';
import { vitestBaseConfig } from './vitest.base';

/**
 * Shared Vitest configuration for the contract tier.
 *
 * Extends the unit-tier base with contract-specific defaults:
 *
 *   - `pool: 'forks'` with `poolOptions.forks.singleFork: false` so every
 *     contract test runs in its own worker process. `freshDb()` returns a
 *     unique tmp-file path per call, so parallelism across forks is safe.
 *   - `isolate: true` so a failing contract test's open SQLite handles or
 *     server bindings cannot leak into the next file's run.
 *   - `hookTimeout` raised to accommodate DB seeding inside `beforeEach`.
 *
 * Workspaces wire this in via the root `vitest.workspace.ts` `contract`
 * project; individual packages do not need to extend it directly.
 */
export const vitestContractConfig = mergeConfig(
  vitestBaseConfig,
  defineConfig({
    test: {
      pool: 'forks',
      // Vitest 4 removed `poolOptions.forks.singleFork` — the previous
      // `singleFork: false` (parallel) is now expressed by leaving
      // `fileParallelism` at its default of `true`. Pinning it here keeps
      // the contract project's intent explicit and resilient to future
      // changes to a workspace's defaults.
      fileParallelism: true,
      isolate: true,
      hookTimeout: 30_000,
      testTimeout: 30_000,
    },
  }),
);

export default vitestContractConfig;
