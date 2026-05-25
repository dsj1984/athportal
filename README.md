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
| Commit hooks | Husky (pre-commit, commit-msg, pre-push) + commitlint + lint-staged | [`commitlint.config.js`](./commitlint.config.js), [`lint-staged.config.js`](./lint-staged.config.js) |
| Cross-file dead-code | knip (strict, no baseline — ADR-0006) | [`knip.config.ts`](./knip.config.ts) |
| Markdown lint | markdownlint-cli2 (defaults + relaxed line-length / table-style) | [`.markdownlint.jsonc`](./.markdownlint.jsonc) |
| Local secret scan | secretlint (recommended preset; pre-commit only — ADR-0006) | [`.secretlintrc.json`](./.secretlintrc.json), [`.secretlintignore`](./.secretlintignore) |

See [`docs/patterns.md` § _Linting: Biome ↔ ESLint scope boundary_](docs/patterns.md#linting-biome--eslint-scope-boundary)
for which tool owns which rule class.

---

## Quick start

```bash
pnpm install                       # install workspace deps
cp .env.example .env               # placeholders only — fill in locally
pnpm dev                           # preflight (.env + local SQLite) + api & web in parallel
pnpm run lint                      # Biome + ESLint + markdownlint (parallel)
pnpm run lint:secrets              # secretlint (matches the pre-commit gate)
pnpm run knip:strict               # full unused-files / -exports / -deps pass
pnpm run typecheck                 # TypeScript across all workspaces
pnpm run test                      # Vitest across all workspaces
pnpm run build                     # Turbo build
pnpm run quality:ci-local          # the full CI chain (lint → typecheck → test → build → baseline + knip + lint:md + lint:secrets)
```

PR titles follow Conventional Commits (`feat:`, `fix:`, `chore:`, …) —
the squash-merge title becomes the commit on `main` and is parsed by
release-please. The `commit-msg` Husky hook enforces the same locally.

---

## Local hooks

Three Husky hooks fire in front of every commit and push. The full
rationale (per-surface posture, wall-clock budgets, why each gate fires
where it does) is in [ADR-0006](./docs/decisions/0006-local-hook-stack.md).

| Hook | When it runs | What it gates | Authoritative file |
| --- | --- | --- | --- |
| `pre-commit` | `git commit` | Refuses changes under `.agents/` (submodule); biome on staged files; lint-staged fan-out (markdownlint on staged `.md`, secretlint on all staged); step-vocabulary linter on staged step / feature files | [`.husky/pre-commit`](./.husky/pre-commit) |
| `commit-msg` | `git commit` (after message edit) | commitlint against `@commitlint/config-conventional` — non-conventional subjects are rejected | [`.husky/commit-msg`](./.husky/commit-msg) |
| `pre-push` | `git push` | Sequential, fail-fast: `typecheck → lint (biome + eslint + markdownlint, parallel inside) → knip:fast → lint:baseline:check → lint:steps`. Wall-clock target < 15 s on a clean tree | [`.husky/pre-push`](./.husky/pre-push) |

**`--no-verify` policy.** Bypassing any of the three hooks
(`git commit --no-verify`, `git push --no-verify`, `--no-gpg-sign`, or
any equivalent flag) is **forbidden without explicit operator
authorization** per [`.agents/rules/git-conventions.md`](./.agents/rules/git-conventions.md)
§ "Push Validation & Reliability". If a hook fails, investigate the
underlying cause and fix it; do not paper over a failure with `--no-verify`.

**Local mirror of CI.** The pre-push chain is intentionally a
**subset** of the CI gate in [`quality.yml`](./.github/workflows/quality.yml).
CI re-runs everything plus the slow gates that don't fit a sub-15 s
budget (coverage / CRAP / maintainability / bundle-size baselines,
mutation testing, lighthouse audits, the supply-chain audit, the
TruffleHog + gitleaks secret-scanner pair). A green pre-push does not
guarantee a green PR — it guarantees that the cheapest-to-detect
regression classes are caught before the push reaches the remote.

---

## CI / CD pipelines

Four GitHub Actions workflows are wired up. Two run on PRs, one on every
push to `main`, and one is manually dispatched.

### `quality.yml` — every PR + every push to `main`

[`.github/workflows/quality.yml`](./.github/workflows/quality.yml)

Fans out 13 parallel jobs on `ubuntu-latest` covering lint, typecheck,
test, build, six ratchet baselines (lint / coverage / CRAP /
maintainability / bundle-size — mutation + Lighthouse run nightly), the
supply-chain CVE gate (ADR-011), two secret scanners (TruffleHog +
gitleaks), the BDD step-vocabulary linter, and a single Playwright-bdd
`@smoke` acceptance scenario. Uses no secrets and runs against
`permissions: contents: read` only (with narrowly-scoped writes on the
secret-scan jobs for SARIF upload).

`pnpm run quality:ci-local` mirrors the same chain locally.

#### Merge gates (required checks on `main`)

Every job above (plus `Guard destructive migrations` from
[`migration-label-guard.yml`](./.github/workflows/migration-label-guard.yml))
is enforced as a **required status check** on `main`. The full set is
14 checks; PRs cannot merge until every one is green. The authoritative
table — including each check's source workflow, what it gates, and its
documented escape hatch (allow-list, `:update` script, or `rationale`
bump per the relevant ADR) — lives in
[`docs/runbooks/branch-protection-setup.md`](./docs/runbooks/branch-protection-setup.md).
The exact JSON used to apply the rule is preserved at
[`docs/runbooks/main-protection.json`](./docs/runbooks/main-protection.json)
so the configuration is reproducible.

The design philosophy: every gate is **reasonable to meet on a
healthy codebase** and ships with a documented escape hatch for the
genuinely-unfixable case. Mutation testing and Lighthouse audits
(expensive, flake-prone) run on the nightly schedule instead of PR CI —
they surface regressions in the nightly report rather than blocking
individual PRs.

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

Supported shape markers: `nonempty`, `url` (absolute URL whose scheme is
`http:`, `https:`, or `libsql:`), `cloudflare-account-id` (32-char
lowercase hex).

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
| `LOGPUSH_SINK_TOKEN` | _(not in `check-env` contract)_ | both environments | **Bearer token for the managed log sink** (vendor recorded in [`docs/decisions/0002-log-sink-vendor.md`](./docs/decisions/0002-log-sink-vendor.md)) that the Cloudflare Logpush job declared in [`apps/api/wrangler.toml`](./apps/api/wrangler.toml) ships the `athportal_request_log` Analytics Engine dataset to. Stored both as a **GitHub Actions secret** (CI renders the Logpush destination URL at deploy time) and as a **Cloudflare Workers secret** (provisioned via `wrangler secret put LOGPUSH_SINK_TOKEN --env <staging\|production>`). Distinct staging vs. production tokens — never share. |
| `TURBO_TOKEN` | _(not in `check-env` contract)_ | both environments | Turborepo remote-cache token. Rotatable. |
| `LIGHTHOUSE_PREVIEW_URL` | _(not in `check-env` contract)_ | `staging` only | Base URL the nightly `lighthouse-baseline` job audits. Consumed via `${{ secrets.LIGHTHOUSE_PREVIEW_URL }}` in [`.github/workflows/nightly.yml`](./.github/workflows/nightly.yml) and forwarded to `pnpm run lighthouse:check`. No `.env.example` entry — it is a per-environment CI secret, not a per-developer var. See [`docs/ops/observability-runbook.md`](./docs/ops/observability-runbook.md#nightly-lighthouse-baseline-setup) for the `gh secret set --env staging` runbook. |

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
