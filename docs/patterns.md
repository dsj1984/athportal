# Patterns

This file is the project's living catalogue of cross-cutting engineering
patterns. Sections below cover only what the current scaffolding requires;
new patterns land here as Stories add them.

## Linting: Biome <-> ESLint scope boundary

The repo uses **two linters with non-overlapping concerns** so each tool
can run at its strengths without fighting the other:

- **Biome** (`biome.json`) owns *stylistic* and *cheap-to-check* rules:
  formatting, quote/semicolon style, organize-imports, correctness/suspicious
  recommended sets. Biome runs on every file the workspace globs match and
  is the fast feedback loop for editor-on-save and pre-commit.
- **ESLint 9 flat config** (`eslint.config.mjs`) is opt-in per workspace
  and runs only the rules that **require TypeScript's type-checker** —
  primarily `@typescript-eslint/no-floating-promises` and
  `no-misused-promises`. `eslint-config-prettier` is appended last so any
  future stylistic rule that sneaks in via a plugin is neutralized; style
  belongs to Biome.

Both linters emit JSON reports that the baseline ratchet (see next section)
aggregates into a single per-file warning tally — they are complementary,
not redundant.

> The deeper version of this boundary, including which rules live where
> and why, is owned by Story #100 (lint scope documentation). The stub
> here exists so the **Lint baseline ratchet** runbook below has a stable
> anchor.

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
