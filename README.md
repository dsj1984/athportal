# AthPortal

Monorepo for the Athlete Portal. Foundation toolchain and two-environment
deploy promotion are in place; the `apps/` and `packages/` workspaces
land in subsequent Epics. Capability tracking lives on
[GitHub Project #6](https://github.com/users/dsj1984/projects/6).

> **Agent context.** Day-to-day mechanics and the always-loaded rule set
> live in [`AGENTS.md`](./AGENTS.md), [`CLAUDE.md`](./CLAUDE.md), and the
> [`.agents/`](./.agents) submodule. This README is the human-facing
> entry point.

---

## Toolchain

| Concern | Tool | Pinned via |
| --- | --- | --- |
| Node runtime | Node 24 | [`.nvmrc`](./.nvmrc) + `engines.node` in [`package.json`](./package.json) |
| Package manager | pnpm 9.15.9 | `packageManager` in [`package.json`](./package.json) |
| Monorepo runner | Turborepo 2 | [`turbo.json`](./turbo.json) |
| Workspaces | `apps/*`, `packages/*` | [`pnpm-workspace.yaml`](./pnpm-workspace.yaml) (folders pending) |
| Lint / format (primary) | Biome 1.9 | [`biome.json`](./biome.json) |
| Lint (type-aware) | ESLint 9 (flat) + `typescript-eslint` | per-workspace `eslint.config.*` |
| TypeScript | strict | [`tsconfig.base.json`](./tsconfig.base.json) |
| Lint baseline ratchet | [`scripts/lint-baseline.mjs`](./scripts/lint-baseline.mjs) | snapshot at [`.lint-baseline.json`](./.lint-baseline.json) |
| Commit hooks | Husky (pre-commit, commit-msg) + commitlint | [`commitlint.config.js`](./commitlint.config.js) |

See [`docs/patterns.md` § _Linting: Biome ↔ ESLint scope boundary_](docs/patterns.md#linting-biome--eslint-scope-boundary)
for which tool owns which rule class.

---

## Quick start

```bash
pnpm install                       # install workspace deps
cp .env.example .env               # placeholders only — fill in locally
pnpm run lint                      # Biome + ESLint
pnpm run typecheck                 # TypeScript across all workspaces
pnpm run test                      # Vitest across all workspaces
pnpm run build                     # Turbo build
pnpm run quality:ci-local          # the full CI chain (lint → typecheck → test → build → baseline)
```

PR titles follow Conventional Commits (`feat:`, `fix:`, `chore:`, …) —
the squash-merge title becomes the commit on `main` and is parsed by
release-please. The `commit-msg` Husky hook enforces the same locally.

---

## CI / CD pipelines

Four GitHub Actions workflows are wired up. Two run on PRs, one on every
push to `main`, and one is manually dispatched.

### `quality.yml` — every PR + every push to `main`

[`.github/workflows/quality.yml`](./.github/workflows/quality.yml)

Chains lint → typecheck → test → build → lint-baseline ratchet on
`ubuntu-latest`. Required check on the `main` branch ruleset. Uses no
secrets and runs against `permissions: contents: read` only.

`pnpm run quality:ci-local` mirrors the same chain locally.

### `migration-label-guard.yml` — every PR

[`.github/workflows/migration-label-guard.yml`](./.github/workflows/migration-label-guard.yml)

Scans added lines in any Drizzle migration file under
`apps/api/**/migrations/**` for `DROP`, `RENAME`, or `NOT NULL ADD`
clauses. Fails the check when matches are found without the
`migration::destructive` PR label. Passes trivially when no migration
files are touched. See [§ Destructive migrations](#destructive-migrations)
below.

### `deploy-staging.yml` — auto on push to `main`

[`.github/workflows/deploy-staging.yml`](./.github/workflows/deploy-staging.yml)

Single job pinned to the `staging` GitHub Environment, so every
deploy-time credential reads from Environment Secrets (not repo-level
secrets). Six logical steps run in order:

1. `pnpm install --frozen-lockfile`
2. `node scripts/check-env.mjs` — fail-fast on any missing / malformed
   key in the foundational env contract.
3. `drizzle-kit migrate` against the staging DB — guarded by
   `hashFiles('apps/api/**')`, no-op until that workspace lands.
4. `wrangler deploy --env staging` — guarded by `hashFiles('apps/api/**')`.
5. `wrangler pages deploy ./dist --project-name athportal-staging` —
   guarded by `hashFiles('apps/web/**')`.
6. `sentry-cli releases new + finalize` with `SENTRY_RELEASE = <short SHA>`
   — runs only if at least one deploy step actually deployed.

Concurrency group `deploy-staging` with `cancel-in-progress: true` — only
the freshest tip of `main` reaches the staging surfaces.

Full operator runbook: [`docs/runbooks/deploy-staging.md`](./docs/runbooks/deploy-staging.md).

### `deploy-production.yml` — `workflow_dispatch` only

[`.github/workflows/deploy-production.yml`](./.github/workflows/deploy-production.yml)

Manually dispatched. The `production` GitHub Environment carries a
required-reviewer rule, so a named human is the single audited gate
between `main` and a production state mutation. Two jobs:

- **`isolation-audit`** — runs first, intentionally **without**
  `environment: production` declared. Asserts that the
  production-only `CLOUDFLARE_API_TOKEN` is unreadable from this
  context. If it leaks, the workflow fails before any state mutation.
  This converts the secret-isolation property from an assumed invariant
  to a tested one.
- **`deploy`** — gated on `isolation-audit`. Same six-step order as
  staging, against production targets (`wrangler deploy --env production`,
  Pages project `athportal-production`). Step 7 writes a rollback link
  to `$GITHUB_STEP_SUMMARY`.

Concurrency group `deploy-production` with `cancel-in-progress: false` —
a production deploy in flight is never interrupted by a newer dispatch.

Full operator runbooks: [`docs/runbooks/rollback.md`](./docs/runbooks/rollback.md)
(rollback paths) and [`docs/runbooks/branch-protection-setup.md`](./docs/runbooks/branch-protection-setup.md)
(required-reviewer rule, required checks).

---

## Environments

Two GitHub Environments back the deploy workflows. **All deploy
credentials live in Environment Secrets, not repo-level secrets.** This
is load-bearing — the production isolation audit job exists specifically
to prove the boundary holds.

| Environment | Trigger | Reviewer rule | Concurrency | Cloudflare targets |
| --- | --- | --- | --- | --- |
| `staging` | auto on push to `main` | none — auto-promote | newer push cancels in-flight | Worker `athportal-api-staging`, Pages `athportal-staging` |
| `production` | `workflow_dispatch` only | required reviewer (named human) | newer dispatch waits, never cancels | Worker `athportal-api-production`, Pages `athportal-production` |

`main` is the only branch allowed to deploy to either environment.
Branch-protection setup (required checks, linear history, the
production reviewer rule) is documented in
[`docs/runbooks/branch-protection-setup.md`](./docs/runbooks/branch-protection-setup.md).

---

## Environment variables

The foundational contract is declared in [`.env.example`](./.env.example).
Every key tagged with `# shape: <name>` is **required** at deploy time
and validated by [`scripts/check-env.mjs`](./scripts/check-env.mjs) as
step 2 of both deploy workflows — a missing or malformed value aborts
the deploy before `drizzle-kit migrate` or `wrangler deploy` can run.
Un-tagged keys in `.env.example` are advisory configuration documentation
and are **not** enforced.

Supported shape markers: `nonempty`, `url`, `cloudflare-account-id`
(32-char lowercase hex).

### Required at deploy time (Environment Secrets, encrypted)

Stored as **Environment Secrets** on the `staging` and `production`
GitHub Environments. Encrypted at rest by GitHub, masked in run logs,
and unreadable from any job that doesn't declare the matching
`environment:` block.

| Key | Shape | Where set | Notes |
| --- | --- | --- | --- |
| `NODE_ENV` | `nonempty` | both environments | `production` in CI even for staging, so bundlers strip dev-only code paths. |
| `DATABASE_URL` | `url` | both environments | Distinct staging vs. production Turso/LibSQL connection strings. Never share. |
| `CLOUDFLARE_API_TOKEN` | `nonempty` | both environments | Scoped to the matching account / project only. The production token MUST NOT be readable from any staging-scoped job — see the production isolation audit. |
| `CLOUDFLARE_ACCOUNT_ID` | `cloudflare-account-id` | both environments | Cloudflare account that owns the Worker + Pages project for that environment. |
| `SENTRY_DSN` | `url` | both environments | Distinct DSNs so staging noise doesn't pollute production alerting. |
| `SENTRY_DSN_WORKERS` | _(not in `check-env` contract)_ | both environments | Per-runtime DSN consumed by `apps/api/src/sentry.ts` (Workers init wrapper). Blank → SDK is a no-op. |
| `SENTRY_DSN_WEB` | _(not in `check-env` contract)_ | both environments | Per-runtime DSN consumed by `apps/web/astro.config.ts` + `apps/web/src/sentry.ts`. Blank → integration is skipped. |
| `SENTRY_DSN_MOBILE` | _(not in `check-env` contract)_ | both environments (EAS for native builds) | Per-runtime DSN consumed by `apps/mobile/src/sentry.ts` (Expo init wrapper). Blank → init returns null. |
| `SENTRY_AUTH_TOKEN` | `nonempty` | both environments | Used only by `sentry-cli releases new + finalize` and per-runtime sourcemap upload at build time. Scoped per-environment. |
| `OBSERVABILITY_ALERT_EMAIL` | _(not in `check-env` contract)_ | both environments | **Single operator-email distribution list of record** (ADR-012 § "Alerting channel"). Every observability vendor — Sentry alert rules, Better Stack uptime failure rules, future log-sink anomaly rules — routes here. Distribution-list shape (not a personal inbox) so the on-call rotation never requires a config change. Consumed by [`infra/uptime/betterstack.yml`](./infra/uptime/betterstack.yml) at apply time and by `apps/api/wrangler.toml` as a Workers secret. |
| `TURBO_TOKEN` | _(not in `check-env` contract)_ | both environments | Turborepo remote-cache token. Rotatable. |

### Required at deploy time (Action variables, non-secret)

Stored as **repo-level Action variables** (`vars.*`). Not encrypted —
treat as public metadata.

| Variable | Where set | Purpose |
| --- | --- | --- |
| `TURBO_TEAM` | repo-level Action variables | Turborepo team slug. Carries no credential. |
| `SENTRY_ORG` | repo-level Action variables | Sentry organization slug. |
| `SENTRY_PROJECT` | repo-level Action variables | Sentry project slug. |

### Computed in the workflow (not stored)

| Key | Source | Notes |
| --- | --- | --- |
| `SENTRY_RELEASE` | `git rev-parse --short HEAD` in step _Compute SENTRY_RELEASE_ | Short Git SHA of the deploying commit. Tags the resulting Sentry release. |

### Advisory / local-only (never committed)

Documented in [`.env.example`](./.env.example) but **not** enforced by
`check-env`. Configure locally in `.env` (gitignored) as needed for
development. Mobile-side Sentry uses `EXPO_PUBLIC_SENTRY_*` and is
sourced from EAS Secrets at build time, not from CI.

- Clerk: `PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_PUBLISHABLE_KEY`,
  `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SECRET`
- Stripe: `STRIPE_PUBLISHABLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- Mux: `MUX_TOKEN_ID`, `MUX_TOKEN_SECRET`, `MUX_WEBHOOK_SECRET`
- Turso (local dev): `TURSO_URL`, `TURSO_AUTH_TOKEN`
- Local debug: `NGROK_AUTHTOKEN`, `DEV_EMAILS`, `DEV_EMAIL`, `DEV_CLERK_USER_ID`
- Agentic QA: `LLM_API_KEY`, `AUTO_HEAL_WEBHOOK_URL`
- Analytics: `POSTHOG_API_KEY`
- Mobile Sentry (EAS Secrets, not CI): `EXPO_PUBLIC_SENTRY_DSN`,
  `EXPO_PUBLIC_SENTRY_ENVIRONMENT`, `EXPO_PUBLIC_SENTRY_RELEASE`

### Secret hygiene

- `.env` and `.env.local` are gitignored. Only `.env.example`
  (placeholders) is committed.
- Real credentials live in GitHub Environment Secret stores, EAS
  Secrets (mobile builds), or a password manager. Never paste a real
  value into a PR, an issue comment, a runbook, or chat.
- Rotation: replace the value in the relevant Environment Secret
  store, then re-run the most recent `deploy-staging` or
  re-dispatch `deploy-production` to confirm the new value flows
  through `check-env` cleanly.
- See [`.agents/rules/security-baseline.md`](./.agents/rules/security-baseline.md)
  for the full secrets-management baseline.

---

## Destructive migrations

Schema changes are the highest-risk class of change in this repo
because they cannot be reverted by `wrangler rollback` once applied.
Any PR that touches a Drizzle migration file under
`apps/api/**/migrations/**` and adds a `DROP`, `RENAME`, or
`NOT NULL ADD` clause is **destructive** and the following rules apply.

- The author MUST apply the **`migration::destructive`** PR label. The
  `migration-label-guard` workflow fails the required check until the
  label is present, so the PR cannot merge without it.
- Two named approvers are required. GitHub branch-protection's required-
  approvers count cannot conditionally bump for one label, so the
  rule is enforced **procedurally**: the first reviewer approves on
  general merit and `@`-mentions a second reviewer; the second
  reviewer's approval is what unlocks the merge.
- The PR author MUST NOT self-merge a `migration::destructive` PR.
- Rollback caveat: `drizzle-kit migrate` is forward-only.
  Re-dispatching `deploy-production.yml` from a prior commit does not
  reverse a migration that has already applied — see
  [`docs/runbooks/rollback.md`](./docs/runbooks/rollback.md) §
  _Migrations and rollback_.

The architectural rationale is the ADR in
[`docs/decisions.md`](./docs/decisions.md); the one-time label bootstrap
lives in [`docs/runbooks/branch-protection-setup.md`](./docs/runbooks/branch-protection-setup.md#one-time-label-bootstrap).
Changes to the policy require superseding the ADR.

---

## Where else to look

- [`AGENTS.md`](./AGENTS.md) — project status, toolchain, and the
  always-loaded agent rule set.
- [`docs/architecture.md`](./docs/architecture.md) — tech-stack
  decisions and the `/api/v1` route-mount convention.
- [`docs/decisions.md`](./docs/decisions.md) — Architecture Decision
  Records.
- [`docs/patterns.md`](./docs/patterns.md) — repeating code patterns
  (lint baseline ratchet runbook, Biome ↔ ESLint scope boundary).
- [`docs/testing-strategy.md`](./docs/testing-strategy.md) — the
  three-tier pyramid and the assertion-placement rule.
- [`docs/runbooks/`](./docs/runbooks/) — operational procedures
  (deploy-staging, rollback, branch protection).
