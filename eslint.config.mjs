// eslint.config.mjs
// Flat-config root for the athportal monorepo.
//
// Scope boundary: Biome owns stylistic rules (formatting, quotes, semicolons,
// import sorting). ESLint is opt-in per workspace and only runs the typed-lint
// rules that require TypeScript's type-checker — primarily `no-floating-promises`
// and `no-misused-promises`. `eslint-config-prettier` is appended last to
// neutralize any stylistic rule that might leak in from a future plugin.
//
// Named exports (apiConfig, webConfig, sharedConfig) let each workspace's
// `lint:eslint` script target only the files that belong to it, so adding a
// workspace-specific rule does not force the rule on every workspace.

import eslint from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

// Mirror biome.json's ignore set so the two linters never disagree about
// what is "the codebase" — Story #374 widened both at once. When `eslint .`
// runs from a workspace dir (post-Story #374 `lint` scripts), these globs
// keep generated output (dist, .turbo, .bdd-gen, test-results, coverage)
// and managed external trees (.agents submodule, .worktrees) out of scope.
const ignores = {
  ignores: [
    '**/dist/**',
    '**/.turbo/**',
    '**/.astro/**',
    '**/.bdd-gen/**',
    '**/test-results/**',
    '**/node_modules/**',
    '**/coverage/**',
    '.agents/**',
    '.worktrees/**',
    '.stryker-tmp/**',
    'reports/**',
    'temp/**',
    'scripts/__fixtures__/**',
  ],
};

// JS baseline — recommended rules only, no type information required. Node
// globals (console, process, Buffer, …) are pulled in so repo-level scripts
// under `scripts/` and `.agents/` lint cleanly without per-file overrides.
const jsBaseline = {
  ...eslint.configs.recommended,
  files: ['**/*.{js,mjs,cjs}'],
  languageOptions: {
    ...eslint.configs.recommended.languageOptions,
    globals: {
      console: 'readonly',
      process: 'readonly',
      Buffer: 'readonly',
      __dirname: 'readonly',
      __filename: 'readonly',
      module: 'readonly',
      require: 'readonly',
      global: 'readonly',
      setTimeout: 'readonly',
      clearTimeout: 'readonly',
      setInterval: 'readonly',
      clearInterval: 'readonly',
      setImmediate: 'readonly',
      clearImmediate: 'readonly',
      URL: 'readonly',
      URLSearchParams: 'readonly',
      fetch: 'readonly',
    },
  },
  // Underscore-prefixed params/locals signal "intentionally unused" by
  // long-standing convention (see lib/baselines/refresh-service.js `_args`).
  // Honor that convention so the no-unused-vars rule does not fight it.
  rules: {
    'no-unused-vars': [
      'error',
      {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      },
    ],
  },
};

// Typed-lint layer — applies only to TS sources, using TypeScript's project
// service so consumers do not have to enumerate tsconfig paths.
const typedLint = [
  ...tseslint.configs.recommendedTypeChecked.map((cfg) => ({
    ...cfg,
    files: ['**/*.{ts,tsx}'],
  })),
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
    },
  },
];

// Per-workspace named configs. Each is a path-scoped layer that workspaces
// can import directly (or that the default export composes here).
//
// The `__testing__/` overlay below points typescript-eslint's project service
// at apps/api/tsconfig.test.json — the default apps/api/tsconfig.json
// intentionally excludes `src/**/__testing__/**` so the test-only auth seam
// (Tech Spec #318 §F) cannot leak into production builds. Without this
// overlay, ESLint's projectService cannot find the test-tier files and
// fails with a Parsing error. See the guard contract test at
// apps/api/src/middleware/__testing__/no-prod-import.contract.test.ts.
export const apiConfig = [
  {
    files: ['apps/api/**/*.{ts,tsx}'],
    rules: {},
  },
  {
    files: ['apps/api/src/**/__testing__/**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: ['apps/api/tsconfig.test.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
];

export const webConfig = [
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    rules: {},
  },
];

export const sharedConfig = [
  {
    files: ['packages/shared/**/*.{ts,tsx}'],
    rules: {},
  },
];

// Tooling overlay — points typescript-eslint's project service at
// tsconfig.tooling.json (root) for the workspace-level config files
// (Vitest, Playwright, Astro, Drizzle, app/build configs) and the web e2e
// step library. Without this, those files live outside every workspace's
// `tsconfig.json` `include`, and projectService fails with `Parsing error:
// <file> was not found by the project service`. Same shape as the
// apps/api/__testing__/ overlay above.
export const toolingConfig = [
  {
    // Globs use `**/` prefixes so they match the same files whether
    // ESLint runs from the repo root (`pnpm run lint:js`) or from a
    // workspace cwd (per-workspace `lint` scripts post-Story #374).
    // Flat-config `files` is matched against the file path as ESLint
    // sees it, which is cwd-relative — anchored-from-root globs miss
    // when cwd is the workspace dir.
    files: [
      '**/vitest.config.ts',
      '**/vitest.workspace.ts',
      '**/vitest.base.ts',
      '**/vitest.contract.ts',
      '**/playwright.config.ts',
      '**/astro.config.ts',
      '**/app.config.ts',
      '**/drizzle.config.ts',
      '**/knip.config.ts',
      '**/e2e/**/*.{ts,tsx}',
    ],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: ['tsconfig.tooling.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    // Tooling-file rule scoping. These rules add real value in `src/`
    // (production code) but are noise on glue code:
    //
    // - `@typescript-eslint/no-unsafe-*` fires on framework configs that
    //   read env vars whose types escape strict typing (Astro
    //   `import.meta.env`, transitively-resolved `defineConfig`). The
    //   right fix is to widen the types upstream, not to silence the
    //   call site.
    // - `@typescript-eslint/require-await` fires on playwright-bdd step
    //   callbacks where the signature is uniformly `async (...) => {}`
    //   for binder consistency even when a particular body has no
    //   awaits. The binder accepts both — the keyword is a readability
    //   convention.
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/require-await': 'off',
    },
  },
];

export default tseslint.config(
  ignores,
  jsBaseline,
  ...typedLint,
  ...apiConfig,
  ...webConfig,
  ...sharedConfig,
  ...toolingConfig,
  prettier,
);
