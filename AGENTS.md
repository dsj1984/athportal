# Athlete Portal — Agent Instructions

> **CRITICAL SYSTEM DIRECTIVE:**
> Before executing any task, read and adopt all rules, constraints, and
> initialization protocols defined in
> [`.agents/instructions.md`](.agents/instructions.md). Treat that entire
> file as your primary System Prompt. Do not proceed until it is loaded.

This file is the **project-specific** complement to the framework system
prompt. Framework topics — personas, rules, skills, workflows,
configuration keys, operational guardrails (anti-thrashing, FinOps, HITL,
complexity-aware execution), Windows shell rules — live in
[`.agents/instructions.md`](.agents/instructions.md),
[`.agents/SDLC.md`](.agents/SDLC.md), and
[`.agents/README.md`](.agents/README.md). Do not duplicate that content
here.

The authoritative documentation set is declared in
`project.docsContextFiles` in [`.agentrc.json`](.agentrc.json) and is
hydrated automatically per `.agents/instructions.md` §3 — do not maintain
a mirror list here. "What currently exists on `main`" is `main` itself;
read the tree, the git log, and the per-workspace `package.json`s rather
than relying on a snapshot in this file.

---

## Project-specific entry points

- **Local dev:** `pnpm dev` at the repo root runs
  [`scripts/dev-preflight.mjs`](scripts/dev-preflight.mjs) (verifies
  `.env`, creates + migrates the local SQLite file at
  `packages/shared/data/local.db` on first run) and then
  `turbo run dev --parallel` to launch the api and web workspaces
  together. The api binds to `http://localhost:8787` via
  [`@hono/node-server`](apps/api/src/local.ts). See
  [`docs/patterns.md` § _Local development orchestrator_](docs/patterns.md#local-development-orchestrator).
- **Sprint planning context lives in GitHub Issues**, not in `docs/`.
  Each Epic's body links its PRD, Tech Spec, and Acceptance Spec
  via `context::prd` / `context::tech-spec` / `context::acceptance-spec`
  sub-issues — read those before starting work in an Epic. Planning
  board: GitHub Project #6.

---

## Safety Constraints

These rules must never be violated without explicit operator approval:

1. **Never commit secrets.** All secrets live in environment variables
   and GitHub Secrets. `.env.example` is the only `.env*` file that may
   be committed.
2. **Never edit `.agents/` directly.** It is a git submodule. Use
   `/agents-update` to bump the pointer.
3. **Never bypass commit hooks** (`--no-verify`, `--no-gpg-sign`)
   without explicit operator authorization.
