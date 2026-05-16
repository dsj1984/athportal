# Athlete Portal — Agent Instructions

> **CRITICAL SYSTEM DIRECTIVE:**
> Before executing any task, you must silently read and adopt all rules, constraints, and initialization protocols defined in [`.agents/instructions.md`](.agents/instructions.md). Treat that entire file as your primary System Prompt. Do not proceed until it is loaded.

This file is the **project-specific** complement to the framework system prompt. It documents what is unique to this repo (layout, stack, safety boundaries, testing pointer). For framework topics — personas, rules, skills, workflows, configuration keys, operational guardrails (anti-thrashing, FinOps, HITL, complexity-aware execution), Windows shell rules — read [`.agents/instructions.md`](.agents/instructions.md), [`.agents/SDLC.md`](.agents/SDLC.md) (Epic → Story → Task lifecycle and the `/epic-plan` · `/epic-deliver` · `/story-execute` · `/single-story-execute` workflow set), and [`.agents/README.md`](.agents/README.md). Do not duplicate that content here.

---

## Project Layout

Turborepo monorepo, pnpm workspaces.

| Workspace          | Stack                                                              |
| ------------------ | ------------------------------------------------------------------ |
| `apps/web/`        | Astro SSR on Cloudflare Pages, React islands                       |
| `apps/mobile/`     | Expo React Native (iOS · Android · Web)                            |
| `apps/api/`        | Cloudflare Workers, Hono router                                    |
| `packages/shared/` | Zod schemas, Drizzle ORM models, RBAC policy, DB client, test fixtures |

---

## Coding Standards (Project-Specific)

Generic standards (strict typing, no placeholder comments, no commented-out code, file-naming conventions) live in [`.agents/instructions.md`](.agents/instructions.md). Project-specific overrides:

- **Formatter / Linter.** Biome ([`biome.json`](biome.json)) is the primary formatter and linter. ESLint flat config is the secondary linter (workspace-scoped via files-glob). Run `pnpm run format` after significant changes. `pnpm run lint` is the validation chain — see [`.agentrc.json`](.agentrc.json) `agentSettings.commands`.
- **Validation at boundaries.** All API inputs are validated with Zod schemas exported from `@repo/shared/schemas`. Re-use existing schemas before defining new ones.
- **Workspace aliases.** Imports cross workspaces only via `@repo/shared`, `@repo/web`, `@repo/api`. No relative imports across workspace boundaries.
- **Lint baseline ratchet.** New lint warnings are blocked by [`baselines/lint.json`](baselines/lint.json). Existing warnings can be resolved incrementally; do not regress the floor.

---

## Documentation Map

```
docs/
├── architecture.md          # System design and tech stack
├── data-dictionary.md       # Schema pointer + cut-table list
├── decisions.md             # Architecture Decision Records (ADRs)
├── features.md              # MVP feature catalog (thesis + persona-organized)
├── patterns.md              # Established coding patterns and library rules
├── personas.md              # MVP persona definitions
├── style-guide.md           # Aesthetic constraints and UI copywriting
├── testing-strategy.md      # Pyramid, decision matrix, per-tier rules (SSOT)
├── web-routes.md            # Web application route definitions
└── ops/                     # Runbooks (e.g. mutation-triage.md)
```

Post-MVP roadmap lives on GitHub: every cut surface is bookmarked by an Epic on the **Version 1.0** or **Someday** milestone. There is no `roadmap.md` file in this repo — `gh issue list --milestone "Version 1.0"` is the source of truth.

The authoritative **mandatory-reading** set is `agentSettings.docsContextFiles` in [`.agentrc.json`](.agentrc.json) — currently:

`architecture.md`, `data-dictionary.md`, `decisions.md`, `patterns.md`, `style-guide.md`, `web-routes.md`.

Sprint planning context lives in **GitHub Issues**, not in `docs/`. Each Epic's body links its PRD and Tech Spec issues via `context::prd` and `context::tech-spec` labels — read those before starting work in an Epic.

---

## Testing

> **Single source of truth:** [`docs/testing-strategy.md`](docs/testing-strategy.md). It owns the pyramid, the per-tier decision matrix, the assertion-placement rule, the forbidden-patterns list, and the CI architecture. Tier-agnostic rules live in [`.agents/rules/testing-standards.md`](.agents/rules/testing-standards.md). Do not duplicate testing rules elsewhere — extend `testing-strategy.md`.

Quick orientation:

- **Unit** — Vitest, colocated `*.test.ts` / `*.test.tsx`. Pure logic, component rendering, all external services mocked.
- **Contract** — Vitest + ephemeral SQLite. `apps/api/src/**/*.contract.test.ts`. All HTTP status codes, wire shapes, error envelopes, and DB side-effect assertions live here — never elsewhere.
- **Acceptance** — Playwright + `playwright-bdd` (web) and Detox + binder (mobile), both binding the shared corpus at [`tests/features/**/*.feature`](tests/features/). Selectors are `data-testid="section-element-action"`; never CSS classes or tag names. User-visible outcomes only.

---

## Safety Constraints

These rules must never be violated without explicit operator approval:

1. **Never modify seed data** ([`packages/shared/src/db/seed.ts`](packages/shared/src/db/seed.ts)) without explicit approval.
2. **Never change API route signatures** (path, method, response shape) without updating the matching Zod schema in `@repo/shared`.
3. **Never modify authentication middleware** ([`apps/api/src/middleware/auth.ts`](apps/api/src/middleware/auth.ts)) — security-critical.
4. **Never delete or rename `data-testid` attributes** without updating every binding in the step library and any legacy `*.spec.ts`.
5. **Never commit secrets.** All secrets live in environment variables and GitHub Secrets. `.env.example` is the only `.env*` file in version control.

Project-level risk-gate heuristics (destructive mutations, auth/security changes, CI/CD gate edits, monorepo-wide rewrites, destructive migrations) are listed in [`.agentrc.json`](.agentrc.json) `agentSettings.planning.riskHeuristics`.

---

## File Ownership

| Domain              | Owner Package | Key Files                                |
| ------------------- | ------------- | ---------------------------------------- |
| Database schema     | `@repo/shared` | `src/db/schema/**/*.ts`                 |
| Validation schemas  | `@repo/shared` | `src/schemas/*.ts`                      |
| RBAC policy         | `@repo/shared` | `src/rbac/policy.ts`                    |
| Test fixtures       | `@repo/shared` | `src/testing/**`                        |
| API routes          | `@repo/api`   | `src/routes/v1/**/*.ts`                  |
| Auth middleware     | `@repo/api`   | `src/middleware/auth.ts` (security-critical) |
| Web pages           | `@repo/web`   | `src/pages/**/*.astro`                   |
| React components    | `@repo/web`   | `src/components/**/*.tsx`                |
| Web step library    | `@repo/web`   | `e2e/steps/**`                           |
| Mobile screens      | `@repo/mobile` | `src/screens/**/*.tsx`                  |
| Mobile step library | `@repo/mobile` | `e2e/steps/**`                          |
| Acceptance corpus   | (root)        | `tests/features/**/*.feature`            |
| Agent protocols     | `.agents/`    | Git submodule — do not edit directly. Use `/agents-update`. |
