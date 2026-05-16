# Athlete Portal — Agent Instructions

> **CRITICAL SYSTEM DIRECTIVE:**
> Before executing any task, you must silently read and adopt all rules, constraints, and initialization protocols defined in [`.agents/instructions.md`](.agents/instructions.md). Treat that entire file as your primary System Prompt. Do not proceed until it is loaded.

This file is the **project-specific** complement to the framework system prompt. It documents what is unique to this repo. For framework topics — personas, rules, skills, workflows, configuration keys, operational guardrails (anti-thrashing, FinOps, HITL, complexity-aware execution), Windows shell rules — read [`.agents/instructions.md`](.agents/instructions.md), [`.agents/SDLC.md`](.agents/SDLC.md), and [`.agents/README.md`](.agents/README.md). Do not duplicate that content here.

---

## Project Status

**Fresh scaffolding.** The application code, workspace layout, build tooling, and docs tree have not been created yet. The repository currently contains only:

- `.agents/` — framework submodule (do not edit directly; use `/agents-update`)
- `.agentrc.json` — project configuration (see [`.agentrc.json`](.agentrc.json))
- `.claude/` — Claude Code harness settings and generated command mirrors
- `.husky/pre-commit` — placeholder hook
- `package.json` — minimal scripts (`sync:commands`, `prepare`, `quality:preview`, `quality:watch`)
- `README.md` — repository pointer

Planned architecture and milestones live on GitHub Project #6. Update this file as real workspaces, docs, and tooling land — keep it honest about what exists today.

---

## Documentation Map

`docs/` does not yet exist. The `project.docsContextFiles` list in [`.agentrc.json`](.agentrc.json) names the files agents are expected to read once they are created (`architecture.md`, `data-dictionary.md`, `decisions.md`, `patterns.md`, `style-guide.md`, `web-routes.md`). Until those files exist, the runtime skips them silently per `.agents/instructions.md` §3.

Sprint planning context lives in **GitHub Issues**, not in `docs/`. Each Epic's body links its PRD and Tech Spec issues via `context::prd` and `context::tech-spec` labels — read those before starting work in an Epic.

---

## Safety Constraints

These rules must never be violated without explicit operator approval:

1. **Never commit secrets.** All secrets live in environment variables and GitHub Secrets. `.env.example` is the only `.env*` file that may be committed.
2. **Never edit `.agents/` directly.** It is a git submodule. Use `/agents-update` to bump the pointer.
3. **Never bypass commit hooks** (`--no-verify`, `--no-gpg-sign`) without explicit operator authorization.
