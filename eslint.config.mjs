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

const ignores = {
  ignores: [
    '**/dist/**',
    '**/.turbo/**',
    '**/node_modules/**',
    '.agents/**',
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
export const apiConfig = [
  {
    files: ['apps/api/**/*.{ts,tsx}'],
    rules: {},
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

export default tseslint.config(
  ignores,
  jsBaseline,
  ...typedLint,
  ...apiConfig,
  ...webConfig,
  ...sharedConfig,
  prettier,
);
