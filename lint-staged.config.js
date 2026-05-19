// lint-staged config — drives the per-file linters that run on Husky's
// pre-commit hook. The full-scope chain (biome / eslint / typecheck /
// knip / baseline) runs at pre-push; this file scopes the fast,
// staged-only linters that should never block a commit on unrelated
// files.
//
// - biome runs on staged files whose extensions biome can lint/format
//   (ts/tsx/js/jsx/mjs/cjs/json/jsonc/css). Routing the biome invocation
//   through lint-staged (instead of a bare `biome check --staged` line
//   in `.husky/pre-commit`) keeps lint-staged as the single source of
//   truth for staged-file linters, so a future contributor can't
//   accidentally double-run biome.
// - markdownlint-cli2 runs on staged .md/.markdown files only.
// - secretlint runs on every staged file regardless of extension —
//   it's the local mirror of CI's TruffleHog/gitleaks gates and the
//   pre-commit window is the only place it executes (ADR-0006).
export default {
  '*.{ts,tsx,js,jsx,mjs,cjs,json,jsonc,css}': [
    'biome check --no-errors-on-unmatched --files-ignore-unknown=true',
  ],
  '*.{md,markdown}': ['markdownlint-cli2'],
  '*': ['secretlint --maskSecrets'],
};
