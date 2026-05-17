# Athlete Portal — Agent Instructions

> **CRITICAL SYSTEM DIRECTIVE:**
> Before executing any task, you must silently read and adopt all rules, constraints, and initialization protocols defined in [`.agents/instructions.md`](.agents/instructions.md). Treat that entire file as your primary System Prompt. Do not proceed until it is loaded.

This file is the **project-specific** complement to the framework system prompt. It documents what is unique to this repo. For framework topics — personas, rules, skills, workflows, configuration keys, operational guardrails (anti-thrashing, FinOps, HITL, complexity-aware execution), Windows shell rules — read [`.agents/instructions.md`](.agents/instructions.md), [`.agents/SDLC.md`](.agents/SDLC.md), and [`.agents/README.md`](.agents/README.md). Do not duplicate that content here.

---

## Project Status

**Foundation toolchain in place; workspace folders pending.** Epic #2
landed the build/lint/test plumbing this repo will use, but the actual
`apps/` and `packages/` workspaces (and their source code) have not been
created yet — Story #121 carries that scaffolding. Update this file as
real workspaces and features land; keep it honest about what exists today.

What currently exists on `main` / `epic/2`:

- **Package manager & workspaces:** pnpm 9.15.9 pinned via `packageManager`
  in [`package.json`](package.json); `pnpm-workspace.yaml` declares
  `apps/*` and `packages/*` globs (the folders themselves are
  intentionally absent until Story #121).
- **Monorepo task runner:** [Turborepo v2](turbo.json) (`turbo run lint`,
  `typecheck`, `test`, `build`) drives the pnpm scripts.
- **Primary linter / formatter:** [Biome 1.9](biome.json) — formatting,
  organize-imports, universal correctness. Runs via `pnpm run lint:biome`
  and on save / pre-commit. See
  [`docs/patterns.md` § _Linting: Biome ↔ ESLint scope boundary_](docs/patterns.md#linting-biome--eslint-scope-boundary)
  for which tool owns which rule class.
- **Secondary linter:** ESLint 9 (flat config) + `typescript-eslint`
  carries the type-aware rules Biome cannot run.
  `eslint-config-prettier` is appended last so any stylistic rule that
  slips in via a plugin is neutralized — style belongs to Biome.
- **TypeScript:** strict via [`tsconfig.base.json`](tsconfig.base.json);
  per-workspace `tsconfig.json` files extend it once those workspaces
  exist.
- **Lint baseline ratchet:** [`scripts/lint-baseline.mjs`](scripts/lint-baseline.mjs)
  with the committed snapshot at
  [`.lint-baseline.json`](.lint-baseline.json). CI calls
  `pnpm run lint:baseline:check`; see `docs/patterns.md` § _Lint baseline
  ratchet_ for the runbook.
- **Commit hygiene:** Husky `pre-commit` runs `pnpm run lint:biome` +
  `pnpm run lint:baseline:check`; Husky `commit-msg` runs
  [`commitlint`](commitlint.config.js) with `@commitlint/config-conventional`.
- **CI gate:** [`.github/workflows/quality.yml`](.github/workflows/quality.yml)
  chains lint → typecheck → test → build → baseline ratchet on every PR
  and push to `main`. `pnpm run quality:ci-local` mirrors the same chain
  locally.
- **Testing:** three tiers wired end-to-end — Vitest unit + contract
  projects ([`vitest.workspace.ts`](vitest.workspace.ts)) run under
  `pnpm run test`; the smoke acceptance scenario at
  [`tests/features/foundation/web-acceptance-smoke.feature`](tests/features/foundation/web-acceptance-smoke.feature)
  runs under `pnpm --filter @repo/web exec bddgen && pnpm --filter @repo/web test:e2e -- --grep @smoke`;
  the step-definition linter at
  [`scripts/lint-steps.mjs`](scripts/lint-steps.mjs) runs under
  `pnpm run lint:steps` and is wired into the Husky `pre-commit` hook
  against staged changes. `quality.yml` gates each PR on `test`,
  `acceptance-smoke`, and `lint-steps` jobs; the nightly schedule at
  [`.github/workflows/nightly.yml`](.github/workflows/nightly.yml) runs
  the full acceptance corpus and the Stryker mutation report. See
  [`docs/testing-strategy.md`](docs/testing-strategy.md) for the tier
  decision matrix and forbidden patterns.
- **Agent framework:** `.agents/` (submodule, do not edit directly),
  `.agentrc.json`, `.claude/` (harness settings + generated command
  mirrors), and a `temp/` scratch directory excluded from git.

Planned architecture and milestones live on GitHub Project #6.

---

## Documentation Map

The `project.docsContextFiles` list in [`.agentrc.json`](.agentrc.json)
is the authoritative read-on-every-task set. Current state of the docs
tree:

- [`docs/architecture.md`](docs/architecture.md) — present
- [`docs/data-dictionary.md`](docs/data-dictionary.md) — present
- [`docs/decisions.md`](docs/decisions.md) — present
- [`docs/patterns.md`](docs/patterns.md) — present; includes
  [`Biome ↔ ESLint scope boundary`](docs/patterns.md#linting-biome--eslint-scope-boundary)
  and the lint-baseline ratchet runbook
- [`docs/style-guide.md`](docs/style-guide.md) — present
- [`docs/web-routes.md`](docs/web-routes.md) — present
- [`docs/testing-strategy.md`](docs/testing-strategy.md) — present
  (referenced from [`CLAUDE.md`](CLAUDE.md) as always-on testing context)

When the runtime hydrates a task, any entry whose file is absent is
skipped silently per `.agents/instructions.md` §3.

Sprint planning context lives in **GitHub Issues**, not in `docs/`. Each
Epic's body links its PRD and Tech Spec issues via `context::prd` and
`context::tech-spec` labels — read those before starting work in an Epic.

---

## Safety Constraints

These rules must never be violated without explicit operator approval:

1. **Never commit secrets.** All secrets live in environment variables and GitHub Secrets. `.env.example` is the only `.env*` file that may be committed.
2. **Never edit `.agents/` directly.** It is a git submodule. Use `/agents-update` to bump the pointer.
3. **Never bypass commit hooks** (`--no-verify`, `--no-gpg-sign`) without explicit operator authorization.
