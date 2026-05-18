// lint-staged config — drives the per-file linters that run on Husky's
// pre-commit hook. The full-scope chain (biome / eslint / typecheck /
// knip / baseline) runs at pre-push; this file scopes the fast,
// staged-only linters that should never block a commit on unrelated
// files.
//
// - markdownlint-cli2 runs on staged .md/.markdown files only.
// - secretlint runs on every staged file regardless of extension —
//   it's the local mirror of CI's TruffleHog/gitleaks gates and the
//   pre-commit window is the only place it executes (ADR-0006).
export default {
  '*.{md,markdown}': ['markdownlint-cli2'],
  '*': ['secretlint --maskSecrets'],
};
