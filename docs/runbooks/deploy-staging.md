# Staging Deploy Runbook — `deploy-staging.yml`

> **One-stop operator reference** for the staging auto-deploy workflow
> shipped by Epic #3 ([#3](https://github.com/dsj1984/athportal/issues/3),
> parent Story [#145](https://github.com/dsj1984/athportal/issues/145)).
> Lives next to [`branch-protection-setup.md`](./branch-protection-setup.md);
> the production counterpart will land alongside `deploy-production.yml`
> in the same Epic.

---

## When this workflow runs

[`.github/workflows/deploy-staging.yml`](../../.github/workflows/deploy-staging.yml)
triggers on every `push` to the `main` branch. There is no manual
`workflow_dispatch` entry point — staging is the auto-promotion target,
production is the manually-approved one (see Tech Spec [#134](https://github.com/dsj1984/athportal/issues/134) § _Environment promotion model_).

The workflow declares `environment: staging` on every job that touches
deploy secrets, so the entire run reads from the `staging` GitHub
Environment's Environment Secrets — not repo-level Secrets. Repo-level
Secrets are intentionally not used for deploy credentials; this keeps the
production credentials physically unreadable from a staging-scoped job.

---

## Required staging Environment Secrets

Every key below MUST exist as an **Environment Secret** on the
`staging` GitHub Environment (`Settings → Environments → staging →
Add secret`). The pre-deploy `check-env` step refuses to proceed until
each one is present and shape-valid against
[`.env.example`](../../.env.example).

| Environment Secret | Shape (per `.env.example`) | Purpose |
| --- | --- | --- |
| `NODE_ENV` | `nonempty` | Sets the runtime mode for build + migrate steps. Staging runs with `NODE_ENV=production` so bundlers strip dev-only code paths. |
| `DATABASE_URL` | `url` | Staging database connection string consumed by `drizzle-kit migrate`. Points at the staging Turso / LibSQL instance; never the production one. |
| `CLOUDFLARE_API_TOKEN` | `nonempty` | API token used by `wrangler deploy` (Workers, api) and `wrangler pages deploy` (Pages, web). Token MUST be scoped to the staging account / project — see § _Rotating Cloudflare credentials_ below. |
| `CLOUDFLARE_ACCOUNT_ID` | `cloudflare-account-id` (32-char lowercase hex) | Cloudflare account that owns the staging Worker + Pages project. |
| `SENTRY_DSN` | `url` | DSN for staging error reports. Distinct from the production DSN so staging noise does not pollute production alerting. |
| `SENTRY_AUTH_TOKEN` | `nonempty` | Used by `@sentry/cli releases new` + `releases finalize` to register the staging release tag. Token MUST be scoped to the staging Sentry project only. |
| `TURBO_TOKEN` | _(secret, not part of the `check-env` contract)_ | Turborepo remote cache token. Stored alongside the public `TURBO_TEAM` Action variable so cache hits show up in the run log per Tech Spec § _Caching strategy_. |

`TURBO_TEAM` is an Action **variable** (not a secret) and lives at the
repo level — it carries no credential, only the team slug.

### How to add or rotate an Environment Secret

1. Open `Settings → Environments → staging`.
2. Under **Environment secrets**, click **Add secret** (or pencil-edit an
   existing one).
3. Name the secret exactly as listed in the table above. Names are
   case-sensitive; `check-env` looks them up verbatim.
4. Paste the new value and **Save**.
5. Re-run the most recent `deploy-staging` run from the **Actions** tab
   (or push a no-op commit to `main`) to confirm the new value flows
   through `check-env` cleanly.

> **Never** paste a real secret into a PR, an issue comment, or this
> runbook. The only legal home for live values is the GitHub Environment
> Secret store. `.env.example` carries placeholders only — see
> [`.agents/rules/security-baseline.md`](../../.agents/rules/security-baseline.md)
> § _Secrets Management_.

---

## Workflow step order

The workflow walks **six** logical steps in this order. Operators
reading a run log should expect each section in sequence:

| # | Step | Command | Fail-fast intent |
| --- | --- | --- | --- |
| 1 | Install dependencies | `pnpm install --frozen-lockfile` | If the lockfile is stale the workflow stops before any state mutation. |
| 2 | Validate environment | `node scripts/check-env.mjs` | Refuses to proceed unless every required Environment Secret is present and shape-valid. |
| 3 | Run staging migrations | `pnpm --filter @repo/api exec drizzle-kit migrate` | Applies pending Drizzle migrations to the staging DB. Guarded by `hashFiles('apps/api/**')` so the step skips while `apps/api` is absent. |
| 4 | Deploy API (Workers) | `pnpm --filter @repo/api exec wrangler deploy --env staging` | Ships the api Worker. Same `hashFiles` guard as step 3. |
| 5 | Deploy Web (Pages) | `pnpm --filter @repo/web exec wrangler pages deploy ./dist --project-name athportal-staging --branch main` | Ships the web Pages project. Guarded by `hashFiles('apps/web/**')`. |
| 6 | Create + finalize Sentry release | `sentry-cli releases new $SENTRY_RELEASE && sentry-cli releases finalize $SENTRY_RELEASE` | Tags the deployed commit so frontend / backend errors after this point are attributed to the new release. Runs only if at least one of steps 4 or 5 ran. |

`SENTRY_RELEASE` is computed from the short Git SHA of the commit being
deployed (`git rev-parse --short HEAD`), matching the convention in
[`.env.example`](../../.env.example) and the SDK wiring noted in the
Tech Spec.

### Why `hashFiles` guards

The Story merges before the `apps/api/` and `apps/web/` workspaces
exist — those workspaces land in later Epics. Each deploy step uses
`if: hashFiles('apps/<workspace>/**') != ''` so the workflow is a green
no-op on a push that does not touch a deployable surface. When the
workspaces materialise the same workflow file lights up automatically;
no second PR is needed.

---

## How to read a failing run

The mapping below covers every step in the workflow. When a step turns
red, jump to the matching row first.

| Failing step | What it means | First remediation |
| --- | --- | --- |
| **Install dependencies** | `pnpm install --frozen-lockfile` failed — usually a drifted lockfile after a manual edit to `package.json` without re-running `pnpm install`. | Pull `main` locally, run `pnpm install`, commit the updated `pnpm-lock.yaml`, and re-push. Never bypass the `--frozen-lockfile` flag in CI. |
| **Validate environment** (`check-env`) | One or more required Environment Secrets are missing or fail shape validation. The step prints the offending key + the expected shape to stderr. | Open `Settings → Environments → staging`, add or fix the offending Environment Secret using the table above, then re-run. If the failure is on a key that does not yet exist in the table, the `.env.example` schema was extended in the same PR — add the key to the Environment Secret store before merging. |
| **Run staging migrations** | `drizzle-kit migrate` failed against the staging DB. Common causes: (a) destructive migration that conflicts with existing data, (b) staging DB unreachable, (c) credentials revoked. | Read the stderr block in the run log. For (a), check whether the PR carries the `migration::destructive` label — that label exists for a reason (see [`branch-protection-setup.md`](./branch-protection-setup.md)). For (b) / (c), rotate `DATABASE_URL` via the Environment Secret flow above and re-run. **Do not** retry a failed destructive migration without first confirming the staging DB is in the expected pre-migration state. |
| **Deploy API (Workers)** | `wrangler deploy --env staging` failed. Usually a Cloudflare auth error (token expired or scoped wrong) or a `wrangler.toml` mismatch. | Confirm `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are still valid (rotate per § _Rotating Cloudflare credentials_). If auth is fine, the failure is a deploy-time error in the api worker itself — check the Workers dashboard for build logs. **Rollback path:** `wrangler rollback --env staging` from a local checkout. The full rollback procedure lives in [`rollback.md`](./rollback.md) once it lands. |
| **Deploy Web (Pages)** | `wrangler pages deploy` failed. Usually a missing build output (`apps/web/dist` empty) or a Pages project name mismatch. | Verify the build step that precedes the deploy produced a `dist/` directory. Confirm the Pages project name in the workflow matches the project in Cloudflare. **Rollback path:** Promote the previous successful Pages deployment from the Cloudflare dashboard, or push a revert commit to `main`. |
| **Create + finalize Sentry release** | `sentry-cli` failed to register the release tag. Either `SENTRY_AUTH_TOKEN` is expired / revoked, or the Sentry org / project slugs in `SENTRY_ORG` / `SENTRY_PROJECT` are wrong. | Rotate `SENTRY_AUTH_TOKEN` via the Environment Secret flow. This step failing **does not** roll back the deploy — the new code is live; only the release tagging is missing. Fix the token and re-run the workflow to backfill the release tag. |

> **General triage rule.** A failure in steps 1–3 means **no state has
> mutated** — the staging DB and the deployed surfaces are untouched, so
> the safe action is "fix and re-run". A failure in steps 4–6 means
> **some state has mutated** — consult [`rollback.md`](./rollback.md)
> before retrying.

---

## Where the deployed URL lives

The workflow does not print a static URL because the staging surface
spans two Cloudflare products. After a green run, the deployed
endpoints are:

- **API (Workers):** `https://athportal-api-staging.<account-subdomain>.workers.dev`
  — the exact subdomain is owned by the Cloudflare account referenced
  by `CLOUDFLARE_ACCOUNT_ID`. The Workers dashboard
  (`https://dash.cloudflare.com/?to=/:account/workers/services/view/athportal-api-staging`)
  is the canonical reference; do not hard-code the URL anywhere a docs
  surface can stale.
- **Web (Pages):** `https://athportal-staging.pages.dev`
  (the Pages project is `athportal-staging` per the workflow). The
  Pages dashboard at
  `https://dash.cloudflare.com/?to=/:account/pages/view/athportal-staging`
  lists every deployment, including the previous successful one for
  rollback.
- **Run summary:** the workflow's GitHub Actions run page links the
  deployed Sentry release tag (`SENTRY_RELEASE = <short SHA>`) which is
  the easiest anchor for cross-referencing front-end and back-end errors
  observed after the deploy.

---

## Rotating Cloudflare credentials

The staging `CLOUDFLARE_API_TOKEN` MUST be a Cloudflare API token (not
the legacy global API key) scoped to **only** the staging account /
zone. The token's permission profile is:

- **Account** → Workers Scripts → Edit
- **Account** → Cloudflare Pages → Edit
- **Zone** → Workers Routes → Edit *(only if the staging Worker is
  bound to a custom zone; omit for `*.workers.dev` deploys)*

To rotate:

1. Mint a new token in the Cloudflare dashboard (`My Profile → API Tokens`).
2. Add the new value to the `staging` Environment Secret store
   (per § _How to add or rotate an Environment Secret_).
3. Trigger a no-op push to `main` (or re-run the most recent
   `deploy-staging` run) and confirm steps 4 and 5 turn green.
4. Revoke the old token in the Cloudflare dashboard.

**Never** copy the production token into the staging Environment, even
temporarily. Cross-environment credential leakage defeats the entire
purpose of the GitHub Environments split.

---

## Cross-references

- Workflow file: [`.github/workflows/deploy-staging.yml`](../../.github/workflows/deploy-staging.yml)
- Pre-deploy validator: [`scripts/check-env.mjs`](../../scripts/check-env.mjs)
- Environment contract: [`.env.example`](../../.env.example)
- Branch protection + required checks: [`branch-protection-setup.md`](./branch-protection-setup.md)
- Tech Spec (full architectural rationale): [#134](https://github.com/dsj1984/athportal/issues/134)
- PRD: [#133](https://github.com/dsj1984/athportal/issues/133)
