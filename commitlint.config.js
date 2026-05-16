/**
 * Commitlint config — Athlete Portal.
 *
 * Pins the allowed Conventional Commit types to the canonical list in
 * .agents/rules/git-conventions.md so the framework and commitlint never
 * disagree on what `<type>(<scope>): <description>` may use. Keep this list
 * in sync with `changelog-sections` in release-please-config.json when a
 * type is added or removed.
 */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'feat',
        'fix',
        'perf',
        'refactor',
        'revert',
        'docs',
        'style',
        'chore',
        'test',
        'build',
        'ci',
      ],
    ],
  },
};
