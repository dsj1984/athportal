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

### What each workspace's `lint` script covers (post-Story #374)

Every workspace's `lint` script runs `pnpm exec biome check . && pnpm
exec eslint .` against the workspace cwd. The intersection of the
workspace tree with `biome.json` `files.include` and
`eslint.config.mjs` `files`/`ignores` produces the actual lint set —
which now includes:

- workspace `src/**`,
- workspace-root config files (`vitest.config.ts`,
  `playwright.config.ts`, `astro.config.ts`, `app.config.ts`,
  `drizzle.config.ts`, `vitest.base.ts`, `vitest.contract.ts`),
- the web `e2e/**` step library.

Pre-Story #374 the scripts only checked `src/`. Anything outside `src/`
was invisible to the workspace gate, IDE-on-save, and pre-commit; the
only catcher was the root baseline sweep. The widened scope makes the
workspace gate honest with the baseline gate.

When adding a new top-level TS file outside `src/` (a new config, a new
glue script), add its glob to **both** `biome.json` `files.include`
**and** the `eslint.config.mjs` `toolingConfig` overlay so the two
linters stay aligned. Story #373's `tsconfig.tooling.json` already
covers the typed-lint side.

## Lint baseline ratchet

The baseline ratchet runs **two channels** against every PR (Story #373):

- **Errors → zero, always.** Any non-zero `errorCount` in the current
  aggregate fails the gate, independent of what the committed baseline
  records. `--update` refuses to absorb errors into a new snapshot — they
  must be fixed in source. Story #374 widened the per-workspace `lint`
  scripts so this channel now catches **the same surface** as the root
  baseline sweep — no more silent gaps between `pnpm --filter <ws> run
  lint` and `pnpm run lint:baseline:check`.
- **Warnings ratchet downward.** Per-file warning regressions and any
  net-total warning increase fail the gate. Warnings are
  `--update`-absorbable when a regression is intentional (a new rule that
  flags existing call sites that will be cleaned up incrementally).

A PR cannot introduce a new error to any file, and cannot introduce a net
warning to any file (or to the total), without explicitly re-snapshotting
the baseline.

### Files and entrypoints

- [`scripts/lint-baseline.mjs`](../scripts/lint-baseline.mjs) — the
  ratchet script. Pure Node ESM, no build step. Runs Biome
  (`--reporter=json`) and ESLint (`--format=json`) with
  `child_process.spawnSync({ shell: false })` so it behaves identically
  under PowerShell and bash. Per-file warning **and error** counts are
  aggregated into the shared baseline envelope
  ([`.agents/schemas/baselines/lint.schema.json`](../.agents/schemas/baselines/lint.schema.json));
  rows are sorted lexicographically so successive runs against an
  unchanged tree produce byte-identical JSON.
- [`baselines/lint.json`](../baselines/lint.json) — the committed
  snapshot. Once Story #373 landed, `rollup.*.errorCount` is `0` and stays
  there.
- [`tsconfig.tooling.json`](../tsconfig.tooling.json) — root tooling
  tsconfig that lets typescript-eslint's project service locate
  workspace-level config files (Vitest, Playwright, Astro, Drizzle, app
  configs) and the web e2e step library. The
  [`eslint.config.mjs`](../eslint.config.mjs) tooling overlay points at
  this file and scopes a few typed-lint rules (`@typescript-eslint/no-unsafe-*`,
  `@typescript-eslint/require-await`) off for these glue paths — those
  rules add real value in `src/` but generate noise in framework configs
  that read untyped env (Astro `import.meta.env`) and in BDD step bodies
  that are uniformly `async` for binder consistency. Mirror this pattern
  when adding new top-level TS files outside any workspace's `tsconfig.json`
  `include`.
- `pnpm run lint:baseline:check` — runs the script in check mode. Exits
  non-zero if **any** error appears, any file gained warnings, or the
  warning total increased.
- `pnpm run lint:baseline:update` — runs the script in update mode.
  Rewrites `baselines/lint.json` from the current tree. Refuses to run
  while errors exist.

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

1. **`pnpm run lint:baseline:check` failed with `errors: N (blocking)`.**
   The check found `N` ESLint / Biome errors that the per-workspace lint
   scripts did not catch. Read the per-file list in stderr, run
   `pnpm exec eslint <file>` and `pnpm exec biome check <file>` against
   each named file to reproduce, fix in source, re-run check. **You cannot
   absorb errors with `--update`** — the script refuses, on the grounds
   that the error floor is zero and silently absorbing them defeats the
   gate. If a rule is genuinely wrong for a tooling file, scope it off in
   the [`eslint.config.mjs`](../eslint.config.mjs) tooling overlay (same
   shape as the existing `no-unsafe-*` / `require-await` scoping) and
   document why in the comment.
2. **`pnpm run lint:baseline:check` failed with a warning regression.**
   Read the stderr listing — it names the files that gained warnings, the
   previous per-file count, and the new count. Fix the new warnings at
   the call site, OR if the change is intentional re-run
   `pnpm run lint:baseline:update`, inspect the diff on
   [`baselines/lint.json`](../baselines/lint.json) to confirm the bump
   matches the change you expect, and commit the snapshot alongside the
   source change. Reviewers should see *both* the warning-introducing
   change and the baseline bump in the same PR.
3. **You fixed warnings and the baseline now over-counts.** Run
   `pnpm run lint:baseline:update` and commit the lowered snapshot so the
   next contributor cannot quietly re-introduce the warnings you just
   removed.
4. **A new top-level TS file (config, build script, glue) added in your
   PR fails parsing.** Add the file's path to
   [`tsconfig.tooling.json`](../tsconfig.tooling.json)'s `include`, and
   add the matching glob to the `files` array in
   [`eslint.config.mjs`](../eslint.config.mjs)'s `toolingConfig` overlay.
5. **Editor noise / local-only failures.** The ratchet runs the same
   linters as `pnpm run lint` and `pnpm exec eslint .`, so a `--check`
   failure that does not reproduce in `pnpm run lint` is a script bug,
   not a code bug — file an issue rather than working around it.

## Priming a baseline (Story #375 runbook)

The seven baseline ratchets (`coverage`, `crap`, `maintainability`,
`mutation`, `bundle-size`, `lighthouse`, `lint`) all share a common
contract: each `*:check` script either **fails on a regression** or
**fails-loud / skips-with-warning** when the baseline is *unprimed* — an
empty zero-rollup snapshot from before any real measurement landed. An
unprimed baseline is **not** a protective gate; it is decoration that
will pass green on a PR that's actually regressing the underlying
metric.

A baseline graduates from unprimed → enforcing in three steps:

1. **Generate a measurement.** Run the producer (`pnpm run test:coverage`
   for coverage, `pnpm run build` for bundle-size, the nightly Stryker
   job for mutation, etc.). The producer writes the artifact the
   ratchet reads.
2. **Snapshot.** Run `pnpm run <kind>:update`. The script reads the
   artifact, writes `baselines/<kind>.json` with real rollups + rows,
   and commits the diff alongside the producer change in the same PR.
3. **Prove the gate bites.** Open a draft PR that deliberately regresses
   the metric by an amount that crosses the gate's tolerance (e.g. -3pp
   on coverage with the ADR-015 -2pp floor), confirm the `*:check`
   fails, restore. Link both runs from the PR description.

### Per-baseline producer commands

| Baseline        | Producer                                                                                       | Where it writes                                                                                 |
| --------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| coverage        | per-workspace `pnpm --filter <ws> exec vitest run --coverage` — CI's `pnpm run test:coverage` writes only root `coverage/coverage-final.json`, but the ratchet reads per-workspace files. **Producer/consumer alignment is the open work for #384.** | `<ws>/coverage/coverage-final.json`                                                              |
| crap            | reuses coverage output (no separate producer)                                                  | reads `<ws>/coverage/coverage-final.json` + source AST                                          |
| maintainability | `pnpm run maintainability:update` runs the producer inline                                     | computed from source AST; no intermediate artifact                                              |
| bundle-size     | `pnpm run build` (per `turbo.json`)                                                            | `<ws>/dist/**` — when every `build` is `exit 0` the ratchet skips with `no measurable bundles` |
| mutation        | `pnpm run mutation` (Stryker, hours-long; nightly artifact preferred)                          | `reports/mutation/mutation.json`                                                                |
| lighthouse      | Lighthouse CLI against a preview env (`LIGHTHOUSE_PREVIEW_URL` env var)                        | computed from headless Chrome run; needs an actual deployed URL                                 |
| lint            | `biome check` + `eslint .` (see § *Lint baseline ratchet* above)                                | aggregated in-process                                                                            |

### Detecting an unprimed baseline

Each `*:check` script tells you which side it's on:

- **Unprimed (gate skips, prints a warn):** `[coverage-baseline] baseline
  is unprimed (all workspace rollups are 0); skipping the -2pp gate.`
  / `[bundle-size-baseline] no measurable bundles found (no dist
  output on disk); skipping the gate.`
- **Unprimed (gate fails loud):** `[lighthouse-baseline]
  LIGHTHOUSE_PREVIEW_URL is not set. Configure it on the staging
  GitHub Environment...`
- **Primed (gate is live):** `[coverage-baseline] ok — 6 workspace(s)
  within the -2pp floor` / `[maintainability-baseline] ok —
  rollup['*'].min=81.713 (floor 70, 63 file(s))`

Fail-loud is acceptable — it surfaces the gap on every CI run. Skip-with-warn is the dangerous one: green PR, no protection.

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

## Bundle-size baseline ratchet

The bundle-size ratchet enforces two distinct contracts on every
PR:

1. **Per-bundle compressed budgets** declared in `.size-limit.json`
   (one entry per shipped bundle). A `gzippedKb` measurement that
   exceeds its budget fails the gate.
2. **The non-negotiable Cloudflare Workers 1 MiB compressed cap.**
   The Worker bundle is `apps/api worker` by convention. The script
   warns at 90% of the cap and fails at 100%, regardless of the
   per-bundle budget. Approaching the cap is a Worker-split
   planning trigger — not a budget bump.

Both contracts are policy-anchored in [ADR-014](decisions.md). The
gate is *regression-first, bump-last*: the lowest-friction reaction
to a failing `:check` is to revert the size delta (strip a
dependency, lazy-load the surface, route-split onto an off-critical
path), not to bump the budget. Bumping is the **last** lever, and
when used it requires a paired changelog entry on the same
`.size-limit.json` bundle row.

### Files and entrypoints

- [`scripts/bundle-size-baseline.mjs`](../scripts/bundle-size-baseline.mjs)
  — the ratchet script. Pure Node ESM, no build step. Reads
  `.size-limit.json`, measures `gzipSync` against each bundle's
  `path` on disk, rolls the per-row sizes into the shared baseline-
  envelope shape, and either `:check`s the current measurements
  against budgets and the 1 MiB Worker cap, or `:update`s
  `baselines/bundle-size.json` from the current tree.
- [`.size-limit.json`](../.size-limit.json) — the per-bundle budget
  - changelog file. One entry per shipped bundle:

  ```json
  {
    "name": "apps/api worker",
    "path": "apps/api/dist/worker.js",
    "gzippedKb": 320,
    "rationale": "initial baseline; matches MVP route surface",
    "lastRevised": "2026-05-17",
    "approvedBy": "@dsj1984"
  }
  ```

  `name` is the row key in `baselines/bundle-size.json`. `path` is
  the file (or glob) measured. `gzippedKb` is the budget enforced.
  `rationale`, `lastRevised`, and `approvedBy` are the per-bundle
  changelog fields ADR-014 requires when bumping `gzippedKb`
  upward — the `rationale` field is the changelog itself, not
  decoration.

- [`baselines/bundle-size.json`](../baselines/bundle-size.json) —
  the committed snapshot. Shape fixed by
  [`.agents/schemas/baselines/bundle-size.schema.json`](../.agents/schemas/baselines/bundle-size.schema.json)
  via the shared
  [`baseline-envelope.schema.json`](../.agents/schemas/baselines/baseline-envelope.schema.json).
  Per-row entries carry `{ bundle, rawKb, gzippedKb }`; the
  whole-repo `*` rollup carries `{ totalKb, gzippedKb }`. Rows
  sorted by `bundle` so re-emission is byte-identical.
- `pnpm run bundle-size:check` — runs
  `node scripts/bundle-size-baseline.mjs --check`. Exits non-zero
  on (a) Worker compressed > 1 MiB, (b) any bundle over its budget,
  or (c) a budget bump unaccompanied by a `rationale`/`lastRevised`
  update. The PR-blocking
  [`bundle-size-baseline` job in `quality.yml`](../.github/workflows/quality.yml)
  is the CI binding; it depends on the `build` job so the wrangler
  dist output is on disk before measurement.
- `pnpm run bundle-size:update` — runs
  `node scripts/bundle-size-baseline.mjs --update`. Regenerates
  `baselines/bundle-size.json` from the current tree.

### Revision procedure (regression-first, bump-last)

ADR-014 defines a strict ordering for responding to a failing
`bundle-size:check`. Reviewers MUST walk the steps in order.

1. **Read the failure log.** The script names the failing bundle,
   its declared budget, and the current measured `gzippedKb`. The
   Worker cap failure carries the rejection string
   `Worker 1 MiB cap exceeded` so it is easy to grep for in CI
   logs.
2. **Regression-first.** Default assumption: an overrun is a
   regression. Identify what landed in the same PR that pushed the
   bundle over — a new dependency, an inlined large constant, a
   route surface that pulled in a previously tree-shaken module.
   Remove or defer the size delta:
   - Strip the dependency (use a lighter alternative, write a
     micro-helper, drop the feature).
   - Lazy-load the surface (dynamic `import()`, route-level code
     split).
   - Move the code off the critical path (Worker → background
     job, web island → user-triggered surface).
3. **Bump-last.** Only when the size delta is *justified* —
   typically a deliberate dependency upgrade or a planned feature
   that genuinely needs the bytes — is the budget itself the right
   lever. Bumping is governed by ADR-014 § Decision:
   1. Update `gzippedKb` on the `.size-limit.json` bundle row.
   2. Update `rationale` on the same row to name the dependency
      or feature that justifies the new headroom. The field is the
      per-bundle changelog; reviewers MUST be able to read the
      file and reconstruct *why* the budget moved over its
      lifetime.
   3. Update `lastRevised` to the current ISO date.
   4. Update `approvedBy` (optional but recommended) to the
      reviewer or operator handle who signed off on the bump.
   5. If the bump exceeds **+25% of the previous limit**, the
      `rationale` MUST also name the alternative considered and
      why it was rejected (per ADR-014). This is a code-review
      enforcement, not a script check — the script guarantees the
      `rationale` field is present, not that its content is
      exhaustive.
4. **Worker cap is special.** The 1 MiB Cloudflare compressed cap
   does **not** participate in the bump procedure. Approaching the
   cap (warn threshold = 90%) triggers a planning Story for a
   Worker split — break the Worker into smaller deployments, move
   non-hot routes onto a separate Worker, or split the API surface
   across Workers per domain. **Never** bump past the cap by
   editing `.size-limit.json`; the script ignores per-bundle
   budgets for the Worker row when the cap is breached.
5. **Refresh the baseline.** After landing the source change (or
   the bump-with-rationale), run `pnpm run bundle-size:update`.
   The script re-measures, rewrites `baselines/bundle-size.json`,
   and the next `:check` against an unchanged tree is byte-
   identical. Commit the refreshed baseline alongside the source
   change — a baseline-only PR is a smell.

### Worked examples

**Legitimate dependency-upgrade bump (accepted).** An Epic upgrades
the API's auth library from `lucia@2` to a v3 release whose
bundle ships an extra 4 KiB gzipped of compatibility shims. The
operator:

- Lands the upgrade and runs `pnpm run bundle-size:check`. It
  fails: `apps/api worker: 322.10 KiB gzipped (budget 320.00 KiB,
  Δ=+2.10 KiB)`.
- Verifies the increase is genuine (tree-shaking confirmed; no
  duplicate copies on the dep graph).
- Edits `.size-limit.json`:
  - `gzippedKb` raised from `320` to `325` (5 KiB headroom for
    future minor revisions of the same dep — keeps successive
    `lucia` patch releases off the gate).
  - `rationale` updated: `"lucia v3 compatibility shims add ~4 KiB
    gzipped vs v2; tree-shaking verified; alternative considered:
    pin to v2 — rejected because v2 ships no security patches
    after 2026-04"`.
  - `lastRevised` updated to today's date.
- Runs `pnpm run bundle-size:update` and commits both files in the
  same PR. The script accepts the bump because both `rationale`
  and `lastRevised` are present and updated on the same row.

**Accidental regression bump (rejected).** A PR raises
`gzippedKb` from `320` to `350` on `.size-limit.json` to clear a
red CI step but does **not** update `rationale` or `lastRevised`.

- `pnpm run bundle-size:check` fails with
  `[bundle-size-baseline] ❌ bundle budget raised without paired
  rationale update — apps/api worker: budget 320.00 → 350.00 KiB
  (missing 'rationale' and 'lastRevised')`.
- The script refuses the bump even though `350 KiB < 1024 KiB`
  (well under the Worker cap). The rationale-paired check is the
  per-bundle changelog enforcement; ADR-014 treats an unpaired
  bump as silently raising the regression bar over time.
- Remediation: revert the budget change, do the work to drop the
  size delta, and either land the source fix (no `.size-limit.json`
  change needed) or land a real bump-with-rationale per the
  worked example above.

### Hand-edit rejection rule

`baselines/bundle-size.json` is **not** a hand-edited file.
Reviewers MUST reject any PR that hand-edits the snapshot — the
only path to update it is to re-run
`pnpm run bundle-size:update`. The script's serialiser sorts
keys, sorts rows by `bundle`, and emits a trailing newline so
byte-identical re-emission is the invariant.

`.size-limit.json`, by contrast, **is** a hand-edited file — it is
the per-bundle budget + changelog source of truth. The script
guarantees the file is valid JSON shaped as an array; reviewers
guarantee the `rationale` content is meaningful and the bump
ordering (ADR-014) was respected.

### Runbook

1. **You ran `pnpm run bundle-size:check` and it failed.** Read
   the stderr listing — the rejection string names whether the
   failure was the 1 MiB Worker cap, a per-bundle budget, or an
   unpaired bump. Walk the revision procedure above starting at
   step 2.
2. **The Worker is at 90%+ of the cap (warning only).** Plan a
   Worker-split Story now — do not wait for the next dep upgrade
   to push the build over the cliff. The warning is the script
   telling you the buffer is gone.
3. **A new bundle was added to `.size-limit.json`.** The first
   `:check` against a newly-declared bundle has no prior baseline
   row to compare against; the rationale-paired check skips it.
   Run `pnpm run bundle-size:update` to prime the row.
4. **A bundle file does not exist on disk yet** (pre-build state,
   as `apps/api` sits today before the wrangler build target
   lands). The script gracefully no-ops the missing row — the
   gate stays a pass and emits a stdout hint to run
   `pnpm run build && pnpm run bundle-size:update` once the build
   target lands. This is the state the freshly-committed
   [`baselines/bundle-size.json`](../baselines/bundle-size.json)
   ships in.
5. **`baselines/bundle-size.json` diverges from current
   measurements but `:check` passes.** That is fine — the
   baseline file is informational on the read side. The gate is
   keyed off `.size-limit.json` budgets, not off baseline drift.
   Run `pnpm run bundle-size:update` to refresh the snapshot when
   you want the committed file to reflect current reality.

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

## Supply-chain CVE remediation via `pnpm.overrides` {#pnpm-overrides-remediation-pattern}

When `scripts/audit-check.mjs` blocks on a High or Critical advisory in a
transitive dependency, the remediation hierarchy is fixed by
[ADR-011](decisions.md#adr-011--supply-chain-cve-gate-is-a-required-check):
**lift the floor of the vulnerable package via `pnpm.overrides`** when an
upstream patched version exists. The allow-list (`IGNORED` map in
`scripts/audit-check.mjs`) is the fallback for the rare advisory with no
upstream patch and a documented unreachability argument — not the default
lever.

> **Reviewer rejection criterion.** Allow-list-first solutions when an
> upstream patch exists are rejected. The PR must add a `pnpm.overrides`
> entry pinning the patched floor; an `IGNORED` entry alongside an
> available patch is a review block, not a discussion.

### Four-step walkthrough

The worked example below uses a placeholder advisory ID
(`GHSA-xxxx-xxxx-xxxx`) and a hypothetical transitive dependency
(`vulnerable-pkg`). Substitute the real values from `pnpm audit --json`
output and the GitHub advisory page when remediating an actual finding.

#### 1. `audit-check` fails

`pnpm run audit:check` (CI's `supply-chain-security` job, mirrored
locally) exits non-zero with a blocking finding:

```text
BLOCKING High/Critical advisories (1):
  - GHSA-xxxx-xxxx-xxxx (vulnerable-pkg) severity=high
    Prototype pollution in vulnerable-pkg <1.4.2
    https://github.com/advisories/GHSA-xxxx-xxxx-xxxx

Remediate via `pnpm.overrides` in package.json (preferred per ADR-011) or,
when no upstream patch exists and a documented unreachability argument
applies, add an IGNORED entry with `reason` + future `revisit` date.
```

#### 2. Identify the upstream patched version

Open the advisory page (`https://github.com/advisories/GHSA-xxxx-xxxx-xxxx`)
and read the **Patched versions** field. If a fixed release exists (for
this example, `>=1.4.2`), continue to step 3 — overrides are the correct
lever. If no patch exists, the allow-list path applies; document the
unreachability argument in an `IGNORED` entry per ADR-011 and stop here.

Confirm the patched version range is compatible with the project's
declared range for that dependency (or any first-party consumers). A
floor bump that breaks a peer-dep constraint requires a coordinated
upgrade, not an override.

#### 3. Add the `overrides` entry

Edit the root `package.json` and add the override under the top-level
`pnpm.overrides` key. The version specifier pins the **minimum** patched
floor — pnpm resolves the highest version in the range that satisfies all
consumers, so a `>=` specifier is preferred over a pinned exact version
unless a known regression rules out a later release.

```jsonc
{
  "name": "athportal",
  "private": true,
  "pnpm": {
    "overrides": {
      // GHSA-xxxx-xxxx-xxxx — prototype pollution in vulnerable-pkg <1.4.2
      "vulnerable-pkg": ">=1.4.2"
    }
  }
}
```

#### 4. Pair the override with the audit-finding ID

Every `pnpm.overrides` entry MUST carry a paired comment naming the
advisory ID that justifies the pin. Without the comment, the override
reads as a stylistic preference and the next reviewer cannot tell whether
removing it is safe. The comment is the hygiene artifact ADR-011 calls
out — `git blame` on the line lands on the PR that introduced the
finding, and the GHSA URL is one click away.

Comment placement: directly above the override entry, inside the
`pnpm.overrides` block, in the format
`// GHSA-xxxx-xxxx-xxxx — <short advisory title>`. JSONC tolerates
single-line comments inside `package.json` for pnpm-managed workspaces;
if the file is strict JSON, move the same metadata into an adjacent
`docs/decisions.md` entry that the override references by commit SHA.

After saving, re-run `pnpm install` to refresh the lockfile and
`pnpm run audit:check` to confirm the finding clears. Commit the
`package.json` change, the lockfile update, and (if applicable) any
documentation cross-reference in a single commit so reviewers see the
override and the cleared advisory together.

## Authenticated test sessions (Clerk test instance)

Acceptance suites that need to drive a protected route sign in once per
persona via a Clerk testing-token JWT minted by the seam at
[`packages/shared/src/testing/auth.ts`](../packages/shared/src/testing/auth.ts).
The seam targets a **Clerk test instance** — never the production
instance — and is consumed by the `signInAs(persona)` Playwright fixture
plus the canonical Gherkin step
`Given I am signed in as {string}`. There is no dev-only auth bypass; the
seam mints **real Clerk testing tokens** against a real Clerk test
instance per the security baseline
([`.agents/rules/security-baseline.md`](../.agents/rules/security-baseline.md)).

### Seeded Clerk test users

Four user accounts live on the Clerk **test instance** (operator-owned —
created via the Clerk dashboard, not via this repo). Each maps to a
persona consumed by the test-auth seam:

| Persona     | Seeded email             | Role         | Org / Team scope                      |
| ----------- | ------------------------ | ------------ | ------------------------------------- |
| `athlete`   | `athlete@test.invalid`   | `member`     | —                                     |
| `coach`     | `coach@test.invalid`     | `team_admin` | seed org A, seed team A-1             |
| `org admin` | `org-admin@test.invalid` | `org_admin`  | seed org A                            |
| `dev admin` | `dev-admin@test.invalid` | `dev_admin`  | —                                     |

These email addresses use the `.invalid` TLD per
[RFC 2606](https://datatracker.ietf.org/doc/html/rfc2606) so they cannot
collide with a real inbox. The persona labels (`'athlete'`, `'coach'`,
`'org admin'`, `'dev admin'`) are the exact strings the Gherkin step
`Given I am signed in as {string}` accepts.

The synthetic-PII guard
([`packages/shared/src/testing/safety.ts`](../packages/shared/src/testing/safety.ts))
ensures fixtures never leak a real address into the suite.

### Seam status (deferred — see Issue #371)

The acceptance-tier sign-in path is currently a **deferred placeholder**.
Story #329 / Task #348 shipped an implementation that signed JWTs locally
with a `CLERK_TESTING_TOKEN_SIGNING_KEY` env var expected to come from
the Clerk dashboard — but Clerk does not expose such a key in any
dashboard surface. Testing tokens are server-minted by Clerk's API
(`clerkClient.testingTokens.createTestingToken()` in `@clerk/backend`),
not signed client-side. The phantom env var has been removed; the seam
is being rewritten in **[Issue #371](https://github.com/dsj1984/athportal/issues/371)**
to use `@clerk/testing/playwright`'s `clerk.signIn` API.

What still works today:

- `authHeaders(user)` for contract-tier sign-in headers (unchanged).
- `signInAs('anonymous')` returning an empty `StorageState` (unchanged).
- `resolvePersona(label)` and the `PERSONA_FIXTURES` table (unchanged —
  the persona ↔ role mapping is stable and inherited by #371).

What throws clearly pointing at #371:

- `signInAs('athlete' | 'coach' | 'org-admin' | 'dev-admin')`.
- The Gherkin step `Given I am signed in as {string}` for any
  non-anonymous persona — invoked only by `@pending`-tagged scenarios
  today, so the throw is never reached in CI.

### Rotation runbook (until #371 lands)

Only two Clerk secrets are operationally active for this repo today:

1. **`CLERK_PUBLISHABLE_KEY` / `PUBLIC_CLERK_PUBLISHABLE_KEY`** — the
   Clerk Publishable key (`pk_test_...` for the test instance). Used by
   `apps/web` server- and client-side and by `apps/api` server-side.
2. **`CLERK_SECRET_KEY`** — the Clerk Secret key (`sk_test_...` for the
   test instance). Used by `apps/api`'s auth middleware and (once #371
   lands) by the Playwright seam to call
   `clerkClient.testingTokens.createTestingToken()`.

To rotate either:

1. **Rotate in the Clerk dashboard.** Open the test instance →
   **Configure → Developers → API keys** (or **Instance → API keys**
   depending on dashboard version) and regenerate the key. Revoke the
   prior key once the new one is confirmed in CI.
2. **Refresh GitHub Secrets** for the affected secret(s) via
   `gh secret set <NAME> --repo dsj1984/athportal` (reads stdin, value
   never lands in shell history).
3. **Bump the local `.env`.** Refresh from `.env.example` placeholders
   and paste the new value(s). The committed `.env.example` carries
   placeholders only — never real keys.
4. **Confirm CI is green.** Push a no-op commit (or re-run the latest
   CI job) and verify the `acceptance-smoke` job passes before closing
   the rotation ticket.

Once Issue #371 lands, this runbook gains a "seed user passwords" step
covering the four test-instance personas (`athlete@test.invalid`,
`coach@test.invalid`, `org-admin@test.invalid`, `dev-admin@test.invalid`).

## Protecting an API route

Every protected route under `/api/v1/*` runs through the two-stage
middleware chain in
[`apps/api/src/middleware/auth.ts`](../apps/api/src/middleware/auth.ts).
The composition is mounted once at the app boundary; individual routes
inherit it.

```ts
// apps/api/src/index.ts (composition root — pattern shown for reference)
import { Hono } from 'hono';
import { clerkAuth, requireInternalUser } from './middleware/auth';

const app = new Hono();

// Stage 1 — every request: validate the Clerk session token.
//   - Reads __session cookie or Authorization: Bearer …
//   - Verifies against CLERK_SECRET_KEY via @clerk/backend.
//   - On failure: 401 { success: false, error: { code: 'UNAUTHENTICATED', … } }
//   - On success: writes c.var.clerkSubjectId.
app.use('*', clerkAuth());

// Stage 2 — protected surface: JIT-provision the internal users row.
//   - Fast path: SELECT users WHERE clerk_subject_id = :sub.
//   - Miss: INSERT … ON CONFLICT DO NOTHING RETURNING *  → re-SELECT on conflict.
//   - On success: writes c.var.auth (AuthContext) for downstream handlers.
app.use('/api/v1/*', requireInternalUser());

// Route handlers read c.var.auth and pass (role, resource, action) into
// canPerform() from @repo/shared/rbac before any state change.
app.get('/api/v1/me', (c) => {
  const { userId, email, role } = c.var.auth;
  return c.json({ success: true, data: { id: userId, email, role } });
});
```

Authorization is a **separate concern** from authentication. Inside a
route handler, after the auth middleware has populated `c.var.auth`,
call `canPerform(role, resource, action, ctx)` from
[`packages/shared/src/rbac/policy.ts`](../packages/shared/src/rbac/policy.ts)
to gate any state mutation. The policy is exhaustively unit-tested
across `(role, resource, action)` triples — never re-derive authorization
logic inline in a route.

Mounting rules:

- `clerkAuth()` MUST mount before `requireInternalUser()`. The second
  middleware reads `c.var.clerkSubjectId`; without the first stage it
  has nothing to look up and defensively returns 401.
- Public routes (e.g. health, OAuth callbacks) MUST be defined **before**
  the `app.use('*', clerkAuth())` line, or carry an explicit
  authentication bypass per the security baseline. Today the only
  unauthenticated surface is the health endpoint at `/api/v1/health` —
  expand the list deliberately, never accidentally.
- Stack traces and internal error details MUST NOT be returned to the
  caller. The middleware emits only the canonical `UNAUTHENTICATED`
  envelope; route handlers do the same for their own failure codes
  (`FORBIDDEN`, `NOT_FOUND`, etc.).

Constraints from `AGENTS.md` §Safety Constraints and the architecture
doc apply to this file: `apps/api/src/middleware/auth.ts` is
security-critical and changes require explicit review.

## Writing an authenticated test

Test-tier choices for an authenticated surface:

| What you are testing | Tier | Tooling |
| --- | --- | --- |
| Pure logic the route depends on (e.g. RBAC policy) | Unit | Vitest, no `createTestApp` |
| Route returns the right wire shape / status / DB row for a given persona | Contract | `createTestApp(db, { actor })` |
| User journeys end-to-end (sign-in redirects, banners, role-gated UI) | Acceptance | Playwright + `Given I am signed in as {string}` |

### Contract tier — `createTestApp(db, { actor })`

The two-argument form of `createTestApp` from
[`packages/shared/src/testing/app.ts`](../packages/shared/src/testing/app.ts)
swaps **only** the JWT-validation stage. The downstream
`requireInternalUser` middleware runs unchanged from production — the
test exercises the real JIT lookup, real `AuthContext` composition, and
real route handler.

```ts
// apps/api/src/routes/v1/<resource>/__tests__/patch.contract.test.ts
import { type AuthContext, createTestApp, freshDb } from '@repo/shared/testing';
import { users } from '@repo/shared/db/schema';
import { requireInternalUser } from '../../../middleware/auth';
import { resourceRoute } from '../resource';

const coach: AuthContext = {
  userId: 'u_coach_1',
  clerkSubjectId: 'user_test_coach',
  email: 'coach@test.invalid',
  role: 'team_admin',
  orgId: 'org_test_a',
  teamId: 'team_test_a_1',
};

it('lets a team_admin update their own team resource', async () => {
  // Arrange — seed the users row so requireInternalUser's fast-path hits.
  const db = await freshDb();
  await db.insert(users).values({
    id: coach.userId,
    clerkSubjectId: coach.clerkSubjectId,
    email: coach.email,
    role: coach.role,
    orgId: coach.orgId,
    teamId: coach.teamId,
  }).run();

  const app = createTestApp(db, { actor: coach })
    .use('/api/v1/*', requireInternalUser())
    .route('/api/v1', resourceRoute);

  // Act
  const res = await app.request('/api/v1/resources/r_1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Renamed' }),
  });

  // Assert — wire shape + DB side-effect.
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ success: true, data: { name: 'Renamed' } });
});
```

For 401 / anonymous-path tests, use the **single-argument** form
(`createTestApp(db)`) — no actor is bound, `c.var.auth` is undefined,
and any handler that reads it surfaces the same `UNAUTHENTICATED`
envelope production emits. See
[`apps/api/src/routes/v1/me.actor.contract.test.ts`](../apps/api/src/routes/v1/me.actor.contract.test.ts)
for the reference test that pins this contract across the four MVP
personas.

### Acceptance tier — `Given I am signed in as {persona}`

Acceptance scenarios sign in once per persona via the canonical Gherkin
step defined in
[`apps/web/e2e/steps/auth.steps.ts`](../apps/web/e2e/steps/auth.steps.ts):

```gherkin
@identity::coach @domain::roster
Feature: Coach invites an athlete

  Scenario: The athlete appears on the roster once they accept
    Given I am signed in as "coach"
    When I invite an athlete by email and they accept the invitation
    Then I see the athlete listed on my team roster
```

The accepted persona labels are `'athlete'`, `'coach'`, `'org admin'`,
`'dev admin'`, and `'anonymous'`. The step calls `resolvePersona(label)`
from the seam at
[`packages/shared/src/testing/auth.ts`](../packages/shared/src/testing/auth.ts).
An unknown label throws a `TypeError` listing the accepted spellings.

**Status (today).** The non-anonymous branches of the step are
deferred pending Issue #371 (rewrite of the seam to
`@clerk/testing/playwright`). Until that issue resolves, persona-required
scenarios in `tests/features/identity/**` must remain `@pending`-tagged;
the step body throws with a pointer to #371 if any scenario drops the
tag prematurely. The seam's persona ↔ role mapping (in `PERSONA_FIXTURES`)
is stable and will be inherited by the refactor. There is no dev-only
auth bypass at any point.

Scenario authoring constraints (cross-cutting with
[`docs/testing-strategy.md` § Forbidden Patterns](testing-strategy.md#forbidden-patterns)):

- Acceptance scenarios assert **user-visible outcomes only**. HTTP
  status codes, JSON shapes, and DB row state belong in the matching
  contract test, not in the `.feature` file.
- Do not author a near-match for `Given I am signed in as {string}`.
  Reuse the canonical phrase verbatim; widen the persona table via a
  follow-up Story if a new role is genuinely needed.
- The testing-token signing key follows the rotation runbook in
  [§ *Authenticated test sessions (Clerk test instance)*](#authenticated-test-sessions-clerk-test-instance)
  above.

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
