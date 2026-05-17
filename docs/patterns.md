# Patterns

This file is the project's living catalogue of cross-cutting engineering
patterns. Sections below cover only what the current scaffolding requires;
new patterns land here as Stories add them.

## Linting: Biome ↔ ESLint scope boundary

The repo uses **two linters with non-overlapping concerns** so each tool
runs at its strengths without fighting the other. The single rule that
resolves every edge case: **when in doubt, Biome wins.** ESLint exists
only to cover rule classes Biome cannot express (today: type-aware
rules; tomorrow: framework-specific plugins).

- **Biome** (`biome.json`) is the **primary** linter and the **sole
  formatter**. It owns formatting, organize-imports, and the universal
  correctness / suspicious / style recommended sets. Biome runs on every
  file the workspace globs match and is the fast-feedback loop driving
  editor-on-save, the Husky `pre-commit` hook, and `pnpm run lint:biome`.
- **ESLint 9 flat config** (per-workspace `eslint.config.mjs`, once the
  workspaces exist) is the **secondary** linter, opt-in per workspace.
  It runs only the rule classes Biome cannot cover — currently the
  type-aware rules from `typescript-eslint` (`no-floating-promises`,
  `no-misused-promises`, etc.) and, in future, framework plugins
  (`eslint-plugin-react`, `jsx-a11y`, `eslint-plugin-astro`, …).
  `eslint-config-prettier` is appended last so any stylistic rule that
  sneaks in via a plugin is neutralized — style belongs to Biome.

Both linters emit JSON reports that the baseline ratchet (see next
section) aggregates into a single per-file warning tally — they are
complementary, not redundant.

### Decision table — which tool owns which rule class

| Rule category                                   | Owner       | Why                                                                                                               |
| ----------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------- |
| Formatting (indent, quotes, semicolons, width)  | **Biome**   | Biome is the sole formatter; Prettier is intentionally absent and `eslint-config-prettier` enforces the absence.  |
| Import ordering / organize-imports              | **Biome**   | Biome's `organize-imports` is the canonical pass; ESLint must not duplicate it.                                   |
| Universal correctness (e.g. `no-unused-vars`, `no-debugger`, `useExhaustiveDependencies`) | **Biome** | Covered by Biome's `recommended` correctness/suspicious sets; no type-checker needed.                              |
| Style / opinion (e.g. `useConst`, `useTemplate`)| **Biome**   | Biome's `style` recommended set is the project's style policy.                                                    |
| Type-aware lint (`no-floating-promises`, `no-misused-promises`, `await-thenable`, `no-unsafe-*`) | **ESLint** | Requires the TypeScript type-checker — Biome cannot run these today.                                              |
| Framework plugins (React hooks rules, JSX-a11y, Astro, Next.js, etc.) | **ESLint** | Biome has no equivalent plugin surface; ecosystem plugins ship as ESLint rules.                                   |
| Test-framework plugins (jest, vitest, playwright) | **ESLint** | Same reason as framework plugins — ecosystem ships ESLint rules.                                                  |
| Conflict / overlap between the two              | **Biome wins** | If both tools can express a rule, disable it in ESLint and let Biome own it; `eslint-config-prettier` enforces this for stylistic overlap. |

When adding a new lint rule:

1. Check Biome's recommended sets first. If Biome already covers it (or
   could cover it via a flag), enable it there and stop.
2. If the rule requires the TypeScript type-checker, add it to the
   relevant ESLint flat config.
3. If the rule is framework-specific (React/JSX/Astro/etc.), add it via
   the appropriate ESLint plugin to the consuming workspace's flat
   config, not to the shared base.
4. If you find yourself disabling a Biome rule to "let ESLint handle
   it" — stop. That is the conflict case; Biome wins. Disable the ESLint
   rule instead.

## Lint baseline ratchet

The baseline ratchet keeps lint warnings **monotonically non-increasing**
across the codebase. It is a CI gate: a PR cannot introduce a net warning
to any file (or to the total) without explicitly re-snapshotting the
baseline.

### Files and entrypoints

- `scripts/lint-baseline.mjs` — the ratchet script. Pure Node ESM, no
  build step. Runs Biome (`--reporter=json`) and ESLint
  (`--format=json`) with `child_process.spawnSync({ shell: false })` so
  it behaves identically under PowerShell and bash. Per-file *warning*
  counts are aggregated into a stable `{ totalWarnings, byFile }`
  envelope; `byFile` keys are sorted lexicographically so successive
  runs against an unchanged tree produce byte-identical JSON.
- `.lint-baseline.json` — the committed snapshot. The single source of
  truth for "how many warnings each file is allowed to have". Diffs against
  this file are the gate.
- `pnpm run lint:baseline:check` — runs `node scripts/lint-baseline.mjs
  --check`. Exits non-zero if any file gained warnings or the total
  increased.
- `pnpm run lint:baseline:update` — runs `node scripts/lint-baseline.mjs
  --update`. Rewrites `.lint-baseline.json` from the current tree.

### Relationship to `quality:preview`

`pnpm run quality:preview` is the **operator-facing convenience** — it
delegates to `.agents/scripts/quality-preview.js --changed-since HEAD`
and surfaces maintainability and CRAP findings on the diff so issues
surface while the change is warm in working memory.

The baseline ratchet is a **separate CI gate**. Run it alongside (not
inside) `quality:preview`:

```sh
pnpm run quality:preview
pnpm run lint:baseline:check
```

Keeping them decoupled means an operator can iterate on a refactor with
`quality:preview` running on every save without re-spawning the
whole-tree Biome and ESLint passes the ratchet needs.

### Runbook

1. **You ran `pnpm run lint:baseline:check` and it failed.** Read the
   stderr listing — it names the files that gained warnings, the previous
   per-file count, and the new count. The fix-first path is to address
   the new warnings (Biome and ESLint output the rule names; fix at the
   call site or, if the rule is genuinely wrong for the codebase, raise
   a ticket to disable it project-wide).
2. **The new warnings are intentional** (e.g. you adopted a new
   rule and have not yet fixed every existing site). Re-run
   `pnpm run lint:baseline:update`, inspect the diff on
   `.lint-baseline.json` to confirm it matches the change you expect,
   and commit the snapshot alongside the source change. Reviewers should
   see *both* the warning-introducing change and the baseline bump in
   the same PR.
3. **You fixed warnings and the baseline now over-counts.** That is the
   happy path — the ratchet only blocks regressions, but a snapshot that
   over-counts hides future improvement. Run
   `pnpm run lint:baseline:update` and commit the lowered snapshot so
   the next contributor cannot quietly re-introduce the warnings you
   just removed.
4. **Editor noise / local-only failures.** The ratchet runs the same
   linters as `pnpm run lint` and `pnpm exec eslint .`, so a `--check`
   failure that does not reproduce in `pnpm run lint` is a script bug,
   not a code bug — file an issue rather than working around it.

## Local quality gate (`quality:ci-local`)

`pnpm run quality:ci-local` is the **local mirror** of the
`.github/workflows/quality.yml` GitHub Actions workflow. It chains the
same five steps the CI job runs, in the same order, failing fast on the
first non-zero exit:

```sh
pnpm run lint \
  && pnpm run typecheck \
  && pnpm run test \
  && pnpm run build \
  && pnpm run lint:baseline:check
```

Use it before pushing to pre-validate a branch against the gate that
will run in CI. A clean exit locally is a strong (but not absolute —
CI runs on a fresh checkout with `--frozen-lockfile`) predictor that
the PR's `quality` check will pass.

### Why a separate script from `quality:preview`?

`quality:preview` is the **operator-facing diff-narrowed convenience**
described above — it delegates to
`.agents/scripts/quality-preview.js --changed-since HEAD` and only
inspects files touched on the working branch. Its job is fast feedback
during iteration, not parity with CI.

`quality:ci-local` is the **CI parity script**. It runs the whole-tree
gates `quality.yml` runs and is intentionally slower. The two scripts
coexist: iterate with `quality:preview`, then run `quality:ci-local`
before push to catch anything the diff-narrowed view missed.

## How to add a new step

The acceptance tier reads from a small, deliberately constrained step
vocabulary. Adding a new step is a cost — it fragments the phrase library
and can hide a near-miss reuse. Follow this runbook so the vocabulary
stays disciplined and the linter stays green.

### Where steps live

The five canonical step files live under
[`apps/web/e2e/steps/`](../apps/web/e2e/steps/):

- `auth.steps.ts` — sign-in, sign-out, role/identity setup.
- `form.steps.ts` — text entry, form submission, file uploads.
- `navigation.steps.ts` — page navigation, URL transitions.
- `rbac.steps.ts` — user-visible authorization outcomes.
- `visibility.steps.ts` — assertions about banners, lists, rows, and
  other on-screen artefacts.

Per-domain step files (one per feature area) sit alongside these
canonical files when a domain accrues enough scenarios to justify its
own bucket. Cross-cutting phrases stay in the canonical five.

### Process

1. **Grep the step library first.** Search the existing
   `apps/web/e2e/steps/*.ts` for the phrase you want. If it exists, reuse
   it verbatim and rephrase the scenario to fit. If a near-match exists,
   widen the parameter (swap a literal for `{string}`) and update every
   call site in the same PR.
2. **Pick the right file.** Keep concerns co-located — auth in
   `auth.steps.ts`, visibility in `visibility.steps.ts`, and so on.
   Cross-cutting phrases that do not fit a canonical file usually mean
   the scenario is asserting an implementation detail; reshape the
   scenario instead of adding a new file.
3. **Honour the tier boundaries.** A step body asserts **user-visible
   outcomes only**. HTTP status codes, DB row state, JSON shapes, and
   raw SQL belong in contract tests — see
   [`docs/testing-strategy.md`](testing-strategy.md) and the
   [assertion-placement rule](../.agents/rules/testing-standards.md#assertion-placement).
4. **Reference the new step from a scenario in the same PR.** Unused
   steps are warnings during development and become errors at Epic close
   (enforced by [`scripts/lint-steps.mjs`](../scripts/lint-steps.mjs)).
5. **Run the linter locally.** `pnpm run lint:steps` runs the same three
   rule classes CI runs (no duplicate phrases, no forbidden patterns, no
   unused steps at Epic close). The Husky `pre-commit` hook also runs
   `pnpm run lint:steps --staged` against staged changes; do not bypass
   it with `--no-verify`.

### Gherkin authoring rules

Phrasing and tag conventions for `.feature` files themselves live in
[`.agents/rules/gherkin-standards.md`](../.agents/rules/gherkin-standards.md).
Read that rule before authoring a new scenario — it covers the canonical
tag taxonomy, the Background discipline, and the forbidden patterns the
linter enforces.
