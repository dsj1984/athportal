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

## Coverage baseline ratchet

The coverage ratchet keeps per-workspace line / branch / function
coverage **within 2 absolute percentage points of the committed
baseline**. It is a CI gate: a PR cannot drop any workspace's coverage
more than 2pp on any axis without explicitly re-snapshotting the
baseline. The 2pp tolerance is the policy fixed in
[ADR-015](decisions.md) — the script and this runbook move together
with that ADR.

### Files and entrypoints

- [`scripts/coverage-baseline.mjs`](../scripts/coverage-baseline.mjs) —
  the ratchet script. Pure Node ESM, no build step. Reads each
  workspace's `coverage/coverage-final.json` (produced by Vitest's V8
  coverage reporter), aggregates per-file `lines` / `branches` /
  `functions` percentages, and rolls them up into the shared
  baseline-envelope shape (`$schema`, `kernelVersion`, `generatedAt`,
  `rollup`, `rows`). Rollup keys and row paths are sorted
  lexicographically so successive runs against an unchanged tree
  produce byte-identical JSON.
- [`baselines/coverage.json`](../baselines/coverage.json) — the
  committed snapshot. The single source of truth for "how much
  coverage each workspace is required to maintain". Diffs against this
  file are the gate. The shape is fixed by
  [`.agents/schemas/baselines/coverage.schema.json`](../.agents/schemas/baselines/coverage.schema.json)
  via the shared
  [`baseline-envelope.schema.json`](../.agents/schemas/baselines/baseline-envelope.schema.json).
- `pnpm run coverage:check` — runs
  `node scripts/coverage-baseline.mjs --check`. Exits non-zero if any
  workspace dropped more than 2pp on any axis (lines, branches,
  functions). The PR-blocking
  [`coverage-baseline` job in `quality.yml`](../.github/workflows/quality.yml)
  is the CI binding.
- `pnpm run coverage:update` — runs
  `node scripts/coverage-baseline.mjs --update`. Regenerates
  `baselines/coverage.json` from the current tree.

### Refresh procedure

1. **Produce coverage reports.** Run `pnpm run test:coverage` to drive
   Vitest's V8 reporter under every workspace. Each workspace emits its
   own `coverage/coverage-final.json`.
2. **Regenerate the baseline.** Run `pnpm run coverage:update`. The
   script re-reads every workspace's coverage report, computes the
   per-workspace rollup, and rewrites `baselines/coverage.json` in
   place. The output is byte-identical across runs against an unchanged
   tree.
3. **Inspect the diff.** Open `baselines/coverage.json` against the
   prior commit. Confirm every per-workspace rollup change is
   justified — a drop is a regression and should not be re-baselined
   without an accompanying source change. A rise is the happy path and
   should be committed so the next contributor cannot quietly
   re-introduce the missing coverage.
4. **Commit the snapshot alongside the source change.** Reviewers
   should see *both* the source change and the baseline bump in the
   same PR. A baseline-only PR is a smell — it means the floor moved
   without a code reason.

### Hand-edit rejection rule

`baselines/coverage.json` is **not** a hand-edited file. Reviewers MUST
reject any PR that hand-edits the snapshot — the only path to update
it is to re-run `pnpm run coverage:update`. This mirrors the
hand-edit rejection rule the other dimension runbooks (lint, CRAP,
maintainability, mutation, lighthouse, bundle-size) enforce.

The script's serialiser sorts keys at every depth and appends a
trailing newline so byte-identical re-emission is the invariant —
any commit that drifts the file off that shape is by definition a
hand-edit and must be reverted.

### Runbook

1. **You ran `pnpm run coverage:check` and it failed.** Read the
   stderr listing — it names the workspace, the axis (lines / branches
   / functions), the prior percentage, the current percentage, and the
   pp delta. The fix-first path is to add tests for the under-covered
   code paths the V8 reporter highlights (open
   `<workspace>/coverage/index.html` to see which files dropped).
2. **The drop is intentional** (e.g. you deleted a feature and its
   tests went with it, lowering the workspace's denominator). Re-run
   `pnpm run coverage:update`, inspect the diff on
   `baselines/coverage.json` to confirm it matches the change you
   expect, and commit the snapshot alongside the source change.
3. **A newly-registered workspace under `apps/*` or `packages/*`.**
   The ratchet treats a new workspace as a pass on the first check
   (no prior rollup to compare against). Run
   `pnpm run coverage:update` to prime the workspace; the next
   `--check` enforces the floor.
4. **Baseline is unprimed** (every per-workspace rollup is `0`). The
   ratchet skips the gate and prints a hint that the operator must
   run `pnpm run coverage:update` once to establish the floor. This is
   the state the freshly-committed
   [`baselines/coverage.json`](../baselines/coverage.json) ships in;
   the first `--update` after this Story merges primes the real
   measurements.
5. **Editor noise / local-only failures.** The ratchet consumes the
   same `coverage-final.json` files Vitest produces, so a `--check`
   failure that does not reproduce after `pnpm run test:coverage` is
   a stale coverage report — delete each workspace's
   `coverage/` directory and rerun.

## CRAP baseline ratchet

The CRAP ratchet keeps every method's CRAP score **within 5% of its
committed baseline value**. CRAP is `c² · (1 − cov)³ + c` where `c` is
cyclomatic complexity and `cov` is the method's coverage ratio — a
method that gets more branches without compensating coverage rises
quickly, so the per-method ratchet catches "complexity grew, tests
didn't" without a flat cap that would penalize disciplined complex
code. It is a CI gate: a PR cannot raise any method's CRAP score by
more than 5% without explicitly re-snapshotting the baseline. The 5%
relative tolerance is the policy fixed in
[ADR-018](decisions.md) — the script and this runbook move together
with that ADR.

### Files and entrypoints

- [`scripts/crap-baseline.mjs`](../scripts/crap-baseline.mjs) — the
  ratchet script. Pure Node ESM, no build step. Walks every JS/TS
  source under `apps/*` and `packages/*` (skipping tests, fixtures,
  build output, and ambient types), scores per-method CRAP via
  [`typhonjs-escomplex`](https://github.com/typhonjs-node-escomplex/typhonjs-escomplex),
  and rolls the per-row scores into the shared baseline-envelope shape
  (`$schema`, `kernelVersion`, `generatedAt`, `rollup`, `rows`). Rows
  are canonically sorted by `(path, startLine, method)` so successive
  runs against an unchanged tree produce byte-identical JSON.
- [`baselines/crap.json`](../baselines/crap.json) — the committed
  snapshot. The single source of truth for "what CRAP score each
  method is allowed to carry". Diffs against this file are the gate.
  The shape is fixed by
  [`.agents/schemas/baselines/crap.schema.json`](../.agents/schemas/baselines/crap.schema.json)
  via the shared
  [`baseline-envelope.schema.json`](../.agents/schemas/baselines/baseline-envelope.schema.json).
- `pnpm run crap:check` — runs
  `node scripts/crap-baseline.mjs --check`. Exits non-zero if any
  method's CRAP score rose more than 5% above the prior baseline
  value. The PR-blocking
  [`crap-baseline` job in `quality.yml`](../.github/workflows/quality.yml)
  is the CI binding.
- `pnpm run crap:update` — runs
  `node scripts/crap-baseline.mjs --update`. Regenerates
  `baselines/crap.json` from the current tree.

### Refresh procedure

1. **Inspect the failure.** Run `pnpm run crap:check` and read the
   stderr listing — it names every regressed method by
   `path:startLine:method`, prints the prior and current CRAP scores,
   and names the relative-5% tolerance the violation tripped.
2. **Fix-first path.** The expected response to a regression is to
   reduce the method's complexity (extract helpers, collapse branches)
   or, when the coverage cross-link Epic lands, raise its statement
   coverage. The script does not auto-suggest a remediation — the
   reviewer is responsible for confirming the source change matches
   the score movement.
3. **Regenerate the baseline.** When the rise is intentional and
   approved, run `pnpm run crap:update`. The script re-scans the tree,
   recomputes per-method scores, and rewrites `baselines/crap.json` in
   place. The output is byte-identical across runs against an
   unchanged tree.
4. **Inspect the diff.** Open `baselines/crap.json` against the prior
   commit. Confirm every per-row movement is justified — a rise is a
   regression and should not be re-baselined without an accompanying
   source change. A drop is the happy path and should be committed so
   the next contributor cannot quietly re-introduce the complexity.
5. **Commit the snapshot alongside the source change.** Reviewers
   should see *both* the source change and the baseline bump in the
   same PR. A baseline-only PR is a smell — it means the floor moved
   without a code reason.

### Hand-edit rejection rule

`baselines/crap.json` is **not** a hand-edited file. Reviewers MUST
reject any PR that hand-edits the snapshot — the only path to update
it is to re-run `pnpm run crap:update`. This mirrors the hand-edit
rejection rule the other dimension runbooks (lint, coverage,
maintainability, mutation, lighthouse, bundle-size) enforce.

The script's serialiser sorts keys at every depth, sorts rows by
`(path, startLine, method)`, and appends a trailing newline so
byte-identical re-emission is the invariant — any commit that drifts
the file off that shape is by definition a hand-edit and must be
reverted.

### Runbook

1. **You ran `pnpm run crap:check` and it failed.** Read the stderr
   listing — it names every regressed method, the prior score, the
   current score, and the relative-5% policy that fired. The fix-first
   path is to refactor the method (extract helpers, collapse branches)
   so the score returns at or below the prior value.
2. **The rise is intentional** (e.g. a new feature that legitimately
   added branches and you accept the higher CRAP for now). Re-run
   `pnpm run crap:update`, inspect the diff on `baselines/crap.json`
   to confirm only the methods you expected to change actually
   changed, and commit the snapshot alongside the source change.
3. **A newly-added method.** The ratchet treats a new row (one whose
   `path:startLine:method` identifier was absent from the prior
   baseline) as a fresh registration. The harness's `relative-pct`
   evaluator on a `lower-is-better` axis treats `prev = 0` plus any
   `next > 0` as a fail, so a freshly-added method with non-zero CRAP
   *does* fire the gate. Run `pnpm run crap:update` to register the
   new method's baseline value alongside its introducing source
   change.
4. **A method moved (refactor changed its `startLine`).** The row
   identifier embeds the start line, so a moved method appears as a
   new row (with `prev = 0`) and the old row drops out. The new row
   triggers the new-row case above. Run `pnpm run crap:update` in the
   same PR as the move so reviewers see both halves of the rename.
5. **Baseline is unprimed** (empty rows + zero rollup). The ratchet
   skips the gate and prints a hint that the operator must run
   `pnpm run crap:update` once to establish the floor. This is the
   state the freshly-committed
   [`baselines/crap.json`](../baselines/crap.json) ships in; the
   first `--update` after this Story merges primes the real
   measurements.
6. **Parse failure on a source file.** The kernel returns an empty
   row list for any file `typhonjs-escomplex` cannot parse, treating
   it as unscorable rather than zero-complexity. If `crap:update`
   reports fewer rows than expected, run the script with
   `--scan-root=<workspace>` against a single workspace to narrow the
   set, then inspect the offending file manually — the underlying
   parser supports TypeScript via the babel-parser, so a persistent
   parse failure usually indicates a syntactic experiment that
   should not be on the main branch.

## Maintainability baseline ratchet

The maintainability ratchet keeps the **whole-repo `rollup['*'].min`
Maintainability Index (MI) at or above 70** — the mandrel framework's
default floor for the dimension. MI is a 0–171 scale (higher is better)
derived from Halstead volume, cyclomatic complexity, and SLOC; a file
that dips below 70 is the canonical "this module needs to be split or
simplified" signal. It is a CI gate: a PR cannot lower the whole-repo
min below 70 without explicitly re-snapshotting the baseline alongside
a source change that justifies the dip. The floor is policy fixed in
[ADR-019](decisions.md) — the script and this runbook move together
with that ADR.

### Files and entrypoints

- [`scripts/maintainability-baseline.mjs`](../scripts/maintainability-baseline.mjs)
  — the ratchet script. Pure Node ESM, no build step. Walks every JS/TS
  source under `apps/*` and `packages/*` (skipping tests, fixtures,
  build output, and ambient types), scores per-file MI via
  [`typhonjs-escomplex`](https://github.com/typhonjs-node-escomplex/typhonjs-escomplex),
  and rolls the per-row scores into the shared baseline-envelope shape
  (`$schema`, `kernelVersion`, `generatedAt`, `rollup`, `rows`). Rows
  are canonically sorted by `path` so successive runs against an
  unchanged tree produce byte-identical JSON. Per-component rollup
  keys auto-populate for each `apps/<name>` and `packages/<name>`
  workspace discovered in the rows; the `*` key is the whole-repo
  rollup and is the axis the gate enforces.
- [`baselines/maintainability.json`](../baselines/maintainability.json)
  — the committed snapshot. The shape is fixed by
  [`.agents/schemas/baselines/maintainability.schema.json`](../.agents/schemas/baselines/maintainability.schema.json)
  via the shared
  [`baseline-envelope.schema.json`](../.agents/schemas/baselines/baseline-envelope.schema.json).
  Per-row entries carry `{ path, mi }`; the rollup carries
  `{ min, p50, p95 }` on every component key.
- `pnpm run maintainability:check` — runs
  `node scripts/maintainability-baseline.mjs --check`. Exits non-zero
  when `rollup['*'].min < 70`. The failure log names the file dragging
  the whole-repo min down so the fix lands on the responsible source.
  The PR-blocking
  [`maintainability-baseline` job in `quality.yml`](../.github/workflows/quality.yml)
  is the CI binding.
- `pnpm run maintainability:update` — runs
  `node scripts/maintainability-baseline.mjs --update`. Regenerates
  `baselines/maintainability.json` from the current tree.

### Refresh procedure

1. **Inspect the failure.** Run `pnpm run maintainability:check` and
   read the stderr listing — it names the current
   `rollup['*'].min`, the configured floor (70), and the worst file
   whose MI matches the min. That file is the one to fix first.
2. **Fix-first path.** The expected response to a sub-floor min is to
   raise the worst file's MI: split a long module, extract a helper,
   collapse deeply-nested branches, or — when the file is structurally
   sound but Halstead volume is dragging the score — reduce the number
   of distinct operators / operands by removing redundant constants
   and centralising shared imports.
3. **Regenerate the baseline.** When a dip is intentional and approved
   (e.g. a new domain module that will be polished in a follow-up
   Story but currently sits below 70 with a documented plan), run
   `pnpm run maintainability:update`. The script re-scans the tree,
   recomputes per-file MI, and rewrites `baselines/maintainability.json`
   in place. The output is byte-identical across runs against an
   unchanged tree. Note: regenerating the baseline does **not** lower
   the floor — the 70 floor lives in ADR-019, not in the snapshot. A
   refreshed baseline with a min below 70 still fails `:check`. The
   refresh is appropriate only when the source change has lifted the
   min back to or above the floor.
4. **Inspect the diff.** Open `baselines/maintainability.json` against
   the prior commit. Confirm every per-row movement is justified — a
   dip is a regression and should not be re-baselined without an
   accompanying source change. A rise is the happy path and should be
   committed so the next contributor cannot quietly re-introduce the
   complexity.
5. **Commit the snapshot alongside the source change.** Reviewers
   should see *both* the source change and the baseline refresh in
   the same PR. A baseline-only PR is a smell — it means the floor's
   inputs moved without a code reason.

### Hand-edit rejection rule

`baselines/maintainability.json` is **not** a hand-edited file.
Reviewers MUST reject any PR that hand-edits the snapshot — the only
path to update it is to re-run `pnpm run maintainability:update`. This
mirrors the hand-edit rejection rule the other dimension runbooks
(lint, coverage, CRAP, mutation, lighthouse, bundle-size) enforce.

The script's serialiser sorts keys at every depth, sorts rows by
`path`, and appends a trailing newline so byte-identical re-emission
is the invariant — any commit that drifts the file off that shape is
by definition a hand-edit and must be reverted.

### Runbook

1. **You ran `pnpm run maintainability:check` and it failed.** Read
   the stderr listing — it names the current `rollup['*'].min`, the
   floor (70), and the worst file whose MI matches the min. The
   fix-first path is to refactor that file (split modules, extract
   helpers, collapse branches) until its MI clears the floor.
2. **The min sits at or just above 70 on `main`.** That is not a
   failure — it is the gate working. A PR that drops the min by even
   one point fails `:check` until the source dip is addressed. Keep
   the headroom: if the project's worst file scores 75 today, the
   next refactor target should aim to lift it to 80, not park new
   complexity at 71.
3. **A newly-added file scores below 70.** The gate fails on the
   first `:check` run that sees the new file. Either raise the MI
   before merging (split / extract) or — if the file is justified at
   its current shape — accept that the gate will block the PR until
   the source change lifts the min. The ADR-019 floor is the policy
   anchor; refreshing the baseline does not relax it.
4. **Baseline is unprimed** (empty rows + zero rollup). The ratchet
   skips the gate and prints a hint that the operator must run
   `pnpm run maintainability:update` once to establish the rollup.
   This is the state the freshly-committed
   [`baselines/maintainability.json`](../baselines/maintainability.json)
   ships in; the first `--update` after this Story merges primes
   the real measurements.
5. **Parse failure on a source file.** The kernel returns `null` for
   any file `typhonjs-escomplex` cannot parse, treating it as
   unscorable rather than zero-MI. Unscorable files are excluded
   from the envelope entirely (a zero would be a phantom floor
   violation no source change can fix). If `maintainability:update`
   reports fewer rows than expected, run the script with
   `--scan-root=<workspace>` against a single workspace to narrow
   the set, then inspect the offending file manually — the
   underlying parser supports TypeScript via the babel-parser, so a
   persistent parse failure usually indicates a syntactic experiment
   that should not be on the main branch.

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
