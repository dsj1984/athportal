import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  // Workspace-aware entry points. Knip auto-detects framework plugins
  // (vitest, playwright, astro, biome, eslint, expo) inside each workspace,
  // so we only declare the bespoke entries those plugins can't infer.
  workspaces: {
    '.': {
      entry: [
        'scripts/**/*.{mjs,ts}',
        'vitest.workspace.ts',
        'vitest.config.ts',
        'lint-staged.config.js',
        'commitlint.config.js',
        'stryker.config.json',
      ],
      project: ['scripts/**/*.{mjs,ts}'],
      // The deps below are consumed by surfaces knip can't follow:
      //   - js-yaml / picomatch / string-argv: required by `.agents/`
      //     submodule scripts (frozen, not in our project graph).
      //   - @commitlint/cli + lint-staged: invoked by `.husky/` shell
      //     hooks via `pnpm exec`.
      //   - @secretlint/secretlint-rule-preset-recommend: referenced
      //     by `.secretlintrc.json`, not by JS imports.
      ignoreDependencies: [
        'js-yaml',
        'picomatch',
        'string-argv',
        '@commitlint/cli',
        'lint-staged',
        '@secretlint/secretlint-rule-preset-recommend',
      ],
    },
    'apps/api': {
      entry: [
        'src/index.ts',
        'src/sentry.ts',
        'src/env.ts',
        'src/routes/**/*.ts',
        'vitest.config.ts',
      ],
    },
    'apps/web': {
      entry: [
        'src/index.ts',
        'src/sentry.ts',
        'astro.config.ts',
        'playwright.config.ts',
        'vitest.config.ts',
        'e2e/**/*.{ts,mjs}',
      ],
    },
    'apps/mobile': {
      entry: ['src/sentry.ts', 'app.config.ts'],
      // @repo/config — declared for future vitest sharing once mobile
      //   grows a unit-test surface beyond the Sentry init wrapper.
      // expo-updates — synthesized by knip's `expo` plugin (every Expo
      //   app is expected to declare it for OTA). Not actually used by
      //   the current app shell; will be added when OTA lands.
      ignoreDependencies: ['@repo/config', 'expo-updates'],
    },
    'packages/baselines': {
      entry: ['src/index.ts'],
    },
    'packages/shared': {
      entry: ['src/index.ts', 'src/testing/index.ts'],
    },
    'packages/config': {
      entry: ['vitest.base.ts', 'vitest.contract.ts'],
    },
  },
  // Ignore the agent submodule (managed externally), the build outputs,
  // the per-worktree scratch dirs, and the generated playwright-bdd
  // bindings under apps/web.
  ignore: [
    '.agents/**',
    '.worktrees/**',
    '**/dist/**',
    '**/coverage/**',
    '**/.bdd-gen/**',
    '**/test-results/**',
    'reports/**',
    'temp/**',
    // Step-linter rejecting fixtures — intentionally malformed BDD
    // step files that prove `scripts/lint-steps.mjs` rejects each rule
    // class. Knip would otherwise flag their `playwright-bdd` /
    // `@playwright/test` imports as unlisted dependencies, but the
    // files are scratch fixtures (`scripts/__fixtures__/` is excluded
    // from biome + eslint for the same reason — see `biome.json`).
    'scripts/__fixtures__/**',
  ],
};

export default config;
