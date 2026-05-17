# Production Rollback Runbook

> **On-call operator playbook** for reverting a production deploy shipped
> through [`deploy-production.yml`](../../.github/workflows/deploy-production.yml).
> Linked from the production workflow's `$GITHUB_STEP_SUMMARY` block
> (Story [#159](https://github.com/dsj1984/athportal/issues/159)) so the
> path from "the deploy is bad" to "production is healthy again" is one
> click from the run page.
>
> Lives next to [`deploy-staging.md`](./deploy-staging.md) and
> [`branch-protection-setup.md`](./branch-protection-setup.md); the
> architectural rationale (Environment Secrets boundary, six-step deploy
> order, isolation-audit invariant) lives in Tech Spec
> [#134](https://github.com/dsj1984/athportal/issues/134) § _Environment
> promotion model_.

---

## When to roll back

Roll back when **observability signals say the new build is the cause**
and the safest forward action is to put production back on the last
known-good build. Typical triggers:

- Sentry shows a new error class spiking on the just-deployed
  `SENTRY_RELEASE` tag (short SHA visible at the top of every Sentry
  event).
- Synthetic / health probes against the Workers API or Pages site fail
  immediately after the deploy step turned green.
- A customer-reported regression reproduces against the new release tag
  and not against the prior one.

A failure **inside** the production deploy workflow itself is **not** the
same as a rollback. If the workflow turned red before step 4 (`Deploy API
to Cloudflare Workers (production)`), no state has mutated and the
correct action is "fix and re-dispatch" — see § _Triage rule_ at the
bottom of this runbook. Use this rollback procedure only when a deploy
turned green and the resulting production state is bad.

---

## The two rollback paths

Production has two deployable surfaces and therefore two rollback paths.
You will typically run **both** when reverting a release that touched
both Workers and Pages; you may run only one when the suspected bad
change is scoped to a single surface.

| Path | Surface | Trigger | Reversal mechanism |
| --- | --- | --- | --- |
| **A. Re-dispatch `deploy-production.yml` from the prior commit** | Workers (api) + Pages (web), together | `workflow_dispatch` from the Actions tab, with `ref` set to the prior `main` commit SHA | Re-runs steps 1–6 of the workflow against the prior tree. Pages publishes a new (older-code) deployment; Workers publishes a new Worker version pinned to the prior code. Both surfaces end up on the prior build. |
| **B. `wrangler rollback`** | Workers (api) only | `wrangler rollback --env production` from a local checkout authenticated against the production Cloudflare account | Promotes the immediately-previous Worker version that Cloudflare retains. Does not redeploy from source; does not touch Pages; does not run migrations. Fastest path when only the api Worker is suspect. |

> **Pages note.** `wrangler rollback` operates on the Workers Versions
> API and does **not** roll back a Pages project. To revert the Pages
> deployment alone, promote the previous successful deployment from the
> Cloudflare Pages dashboard (described in § _Path A — verification_
> below). Path A re-dispatch is the only path that reverts both surfaces
> in one motion.

---

## Path A — Re-dispatch `deploy-production.yml` from the prior commit

This path runs the full production workflow — isolation audit, migrate,
deploy api, deploy web, Sentry release tagging — against an older `main`
commit. It is the **canonical** rollback when both surfaces are
suspect or when the bad release tagged both.

### Step A1. Identify the prior known-good commit

On the GitHub Actions tab, open the `deploy-production` workflow. Find
the **previous** successful run (the one immediately before the bad
deploy). The run's title links the commit; copy its full SHA (or the
short SHA — both work for `workflow_dispatch`).

You can also resolve the prior commit from a local checkout:

```bash
# Two-commits-back on main is the rollback target when the bad deploy
# is the tip.
git fetch origin main
git log --oneline origin/main -n 5
```

The first commit listed is the bad one; the second is your rollback
target.

### Step A2. Dispatch the workflow against that commit

1. Open `Actions → deploy-production → Run workflow`.
2. In the **Use workflow from** dropdown, switch from `Branch: main` to
   **Tag** or **Branch** as needed and paste the rollback-target SHA in
   the **Ref** input (GitHub accepts a full SHA here even when the
   dropdown reads "branch").
3. Click **Run workflow**.

GitHub queues the dispatch. The `production` Environment's
required-reviewer rule fires before the deploy job starts — approve the
run from the Actions tab. The isolation-audit job runs first
(intentionally without `environment: production` declared) and must
turn green; if it fails the entire workflow stops before any state
mutation, per Tech Spec § _Secret isolation_.

### Step A3. Watch the six-step deploy order

Expect the same step order documented for staging in
[`deploy-staging.md`](./deploy-staging.md), but against production
targets:

1. Install dependencies (`pnpm install --frozen-lockfile`).
2. Validate environment (`node scripts/check-env.mjs`).
3. Production migrations (`pnpm --filter @repo/api exec drizzle-kit
   migrate`) — guarded by `hashFiles('apps/api/**')`.
4. Deploy API to Workers (`pnpm --filter @repo/api exec wrangler deploy
   --env production`).
5. Build + deploy Web to Pages (`pnpm --filter @repo/web exec wrangler
   pages deploy ./dist --project-name athportal-production --branch
   main`).
6. Create + finalize Sentry release (`sentry-cli releases new …`,
   `sentry-cli releases finalize …`). The release tag is the
   rollback-target short SHA, **not** the bad SHA — Sentry will now
   attribute new errors to the older release tag.

> **Migrations and rollback.** `drizzle-kit migrate` is **forward-only**.
> Re-dispatching against a prior commit applies any migrations recorded
> in the migrations directory **at that prior tree state** — it does not
> reverse migrations that have already been applied to the production
> DB. If the bad deploy included a `migration::destructive` change (see
> [`branch-protection-setup.md`](./branch-protection-setup.md)), re-
> dispatching from the prior commit will **not** undo the schema
> change. Treat destructive migrations as a separate incident; do not
> assume Path A restores DB state.

### Path A — Verification

After the re-dispatch run turns green, confirm both surfaces are back on
the prior build.

**Verify the Workers (api) surface.**

```bash
# List recent versions deployed to the production Worker. The version
# at the top of the list should match the rollback-target short SHA.
wrangler versions list --name athportal-api-production
```

The top entry's `Tag` / `Message` should reference the prior commit (the
workflow writes the short SHA into the version metadata via the
`SENTRY_RELEASE` env). You can also hit the Worker's health endpoint
and confirm the `X-Release` / version header matches the prior SHA, if
the api exposes one.

**Verify the Pages (web) surface.**

1. Open `Cloudflare dashboard → Pages → athportal-production →
   Deployments`.
2. The deployment at the top of the list should carry the rollback-
   target commit SHA and show **Production** as its environment.
3. If the dashboard still shows the bad deployment as Production,
   click the older (rollback-target) deployment's `…` menu and choose
   **Promote to production**. This is a one-click belt-and-suspenders
   step; the re-dispatch should have already done it.

**Verify Sentry attribution.**

Open `Sentry → Releases` and confirm the rollback-target short SHA is
the most recent release. Errors observed from this point forward should
attribute to that release tag, not the bad one.

---

## Path B — `wrangler rollback` (Workers only)

Use Path B when the suspected bad change is scoped to the api Worker
and you need the fastest possible reversal. `wrangler rollback`
promotes the **immediately-previous** Worker version that Cloudflare
retains in its version history. It does not redeploy from source, does
not run migrations, and does not touch the Pages project.

### Prerequisites for Path B

- A local checkout of `main` (or any ref) with `pnpm install` already
  run, so `pnpm --filter @repo/api exec wrangler` resolves.
- `CLOUDFLARE_API_TOKEN` set in your local shell, scoped to the
  **production** Cloudflare account with `Workers Scripts → Edit`
  permission. The production token lives in the `production` GitHub
  Environment Secret store and **must not** be checked out into a
  local `.env` file under any circumstances — keep it in your
  password manager and export it only for the duration of the
  rollback shell session.
- `CLOUDFLARE_ACCOUNT_ID` set to the production account ID.

### Step B1. Run the rollback

```bash
# From the repo root, against the production Worker.
pnpm --filter @repo/api exec wrangler rollback --env production
```

Wrangler prints the previous version's metadata and asks for
confirmation before promoting it. Confirm only after the printed
version matches the expected rollback target (the prior short SHA).

If you need to roll back to a specific older version (not just the
immediately-previous one), pass the version ID explicitly:

```bash
# List versions, then roll back to a specific one.
pnpm --filter @repo/api exec wrangler versions list --name athportal-api-production
pnpm --filter @repo/api exec wrangler rollback <version-id> --env production
```

### Path B — Verification

```bash
# The top entry should now match the rollback-target version ID.
pnpm --filter @repo/api exec wrangler versions list --name athportal-api-production
```

Hit the api health endpoint and confirm the response indicates the
older build (release header, version field in a `/version` route, etc.,
depending on what the api exposes).

**Sentry attribution caveat.** Unlike Path A, `wrangler rollback` does
not create a new Sentry release tag. Errors observed after the rollback
will continue to attribute to the bad release tag until either (a) a
new deploy lands or (b) you manually create a Sentry release for the
rolled-back version with `sentry-cli releases new <prior-short-sha>`.

---

## When to use which path

| Situation | Use |
| --- | --- |
| Both api and web look bad after a deploy that touched both. | **Path A.** Reverts both surfaces in one motion. |
| Only api is bad; web is fine; speed matters. | **Path B.** Fastest reversal. Pages stays on the new (good) build. |
| Only web is bad; api is fine. | **Path A**, scoped to a re-dispatch from the prior commit, OR promote the previous Pages deployment manually from the dashboard (`Cloudflare → Pages → athportal-production → Deployments → … → Promote to production`). `wrangler rollback` does not apply here. |
| The bad deploy included a destructive migration. | **Treat as a separate incident.** Neither path reverses an applied migration. Page the DB owner and follow the forward-fix procedure. Path A may still be appropriate for the api / web surfaces, but understand the schema is now ahead of the code. |
| The production workflow turned red **before** step 4 (no state mutation). | **Do not roll back.** Fix the failure and re-dispatch the same commit. See § _Triage rule_ below. |

---

## Incident-comms template

Paste this into the team incident channel (Slack `#prod-incidents` or
equivalent) the moment you decide to roll back. Fill in the
bracketed fields; leave the rest verbatim so subscribers can scan it
fast.

```text
:rotating_light: Rolling back production — [path A | path B]

What's wrong: [one-line user-visible symptom, e.g. "API 500s on every
request after the 14:32 UTC deploy"]
Signal: [Sentry / synthetic / customer report — link]
Bad release tag: [short SHA of the bad deploy, from the
deploy-production run summary]
Rollback target: [short SHA we're going back to]
Path: [A — re-dispatching deploy-production.yml from the prior commit
       | B — wrangler rollback against the production Worker]
Owner: [your handle]
ETA to verified-rolled-back: [~10m for path A, ~3m for path B]

I'll update this thread when:
  - the rollback workflow / wrangler command starts
  - both verification steps (Workers version list + Pages dashboard,
    or wrangler versions list for path B) confirm the prior build
  - the next forward-fix plan is queued
```

### Post-rollback follow-ups (within 24h)

Drop these into the same thread once production is verified-rolled-back:

1. **File a post-incident issue.** Link the bad release tag, the rollback
   target, the rollback workflow run (Path A) or the local shell session
   (Path B), and the Sentry release page.
2. **Re-attribute Sentry errors if Path B was used.** Either let the next
   forward deploy reset the release tag, or run `sentry-cli releases
   new <prior-short-sha>` to attribute new errors to the rolled-back
   build explicitly.
3. **Confirm the destructive-migration label** (if any) was on the bad
   PR. If it was missing, that is a separate bug in the migration label
   guard ([`branch-protection-setup.md`](./branch-protection-setup.md)).
4. **Schedule the forward fix.** A rollback is a holding action, not a
   resolution. The forward fix lands on `main` and re-deploys through
   `deploy-production.yml` like any other change.

---

## Triage rule

A failure **inside** the production deploy workflow is not a rollback
event:

- Steps 1–3 (install / `check-env` / migrate-detection) failing means
  **no state has mutated** — the production DB, Workers, and Pages are
  untouched. Fix the failure (usually a missing Environment Secret or a
  stale lockfile) and re-dispatch the same commit. Do **not** run a
  rollback.
- Steps 4–6 (deploy api / deploy web / Sentry release) failing **may**
  have mutated state. If step 4 turned green but step 5 turned red, the
  api is on the new build but Pages is not — this is a partial deploy,
  not a bad deploy, and the correct action is usually to re-dispatch
  the same commit (idempotent). Roll back only if the partial state is
  itself causing user-visible breakage.

In all cases, the rollback paths in this runbook are the canonical
reverse-the-release motion; the staging counterpart's "fix and re-run"
guidance ([`deploy-staging.md`](./deploy-staging.md) § _How to read a
failing run_) covers workflow-level failures.

---

## Cross-references

- Production workflow: [`.github/workflows/deploy-production.yml`](../../.github/workflows/deploy-production.yml)
- Staging counterpart: [`deploy-staging.md`](./deploy-staging.md)
- Pre-deploy validator: [`scripts/check-env.mjs`](../../scripts/check-env.mjs)
- Environment contract: [`.env.example`](../../.env.example)
- Branch protection + migration label guard: [`branch-protection-setup.md`](./branch-protection-setup.md)
- Tech Spec (full architectural rationale): [#134](https://github.com/dsj1984/athportal/issues/134)
- PRD: [#133](https://github.com/dsj1984/athportal/issues/133)
- Wrangler rollback reference: <https://developers.cloudflare.com/workers/wrangler/commands/#rollback>
