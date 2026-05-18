# Branch Protection Setup — `main`

> **Source of truth for re-applying branch protection.** GitHub stores
> branch-protection rules in repo settings, not in the codebase. If this
> repo is forked, migrated, or its protection rule is wiped, this runbook
> is what an operator follows to restore the canonical configuration
> identically. Lands as part of **Epic #3 — CI pipelines, two-environment
> deploy promotion, and secret management** ([#3](https://github.com/dsj1984/athportal/issues/3));
> the canonical PR quality gate it pins is established by Epic #2.

---

## When to run this runbook

- Bootstrapping a new fork or migration of `athportal`.
- After a repo admin accidentally deletes the `main` branch ruleset.
- When adding a new required check that must be enforced on `main`
  (extend the table below in the same PR that introduces the workflow).

The operator applies these rules **once** via the GitHub UI. The runbook
is the textual record; the UI is the authoritative writer.

---

## Required configuration

Apply each section to the `main` branch via **Settings → Branches →
Branch protection rules → `main`** (or the equivalent **Rulesets** page
on newer repos).

### 1. Required status checks

Enable **Require status checks to pass before merging** and **Require
branches to be up to date before merging**, then mark every check below
as required. The full set was applied to `main` as part of **Epic #6 —
Seven quality baselines, ratchet gates, and supply-chain CVE gate**
([#6](https://github.com/dsj1984/athportal/issues/6), squash-merged as
`9ddb542`).

| Check name                                                              | Source workflow                                                                       | What it gates                                                                                                              |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `Lint`                                                                  | [`quality.yml`](../../.github/workflows/quality.yml)                                  | Biome + ESLint clean across every workspace; cheap, deterministic.                                                         |
| `Typecheck`                                                             | [`quality.yml`](../../.github/workflows/quality.yml)                                  | TypeScript strict mode across every workspace.                                                                             |
| `Test (unit + contract)`                                                | [`quality.yml`](../../.github/workflows/quality.yml)                                  | Vitest unit + contract suites under `pnpm run test`.                                                                       |
| `Build`                                                                 | [`quality.yml`](../../.github/workflows/quality.yml)                                  | `pnpm run build` across every workspace; gated on `[lint, typecheck, supply-chain-security]`.                              |
| `Supply-chain security (ADR-011)`                                       | [`quality.yml`](../../.github/workflows/quality.yml)                                  | `pnpm run audit:check`. Blocks on any unsuppressed High/Critical CVE. **Escape hatch**: `IGNORED` allow-list per [ADR-011](../decisions.md). |
| `TruffleHog (secret scan)`                                              | [`quality.yml`](../../.github/workflows/quality.yml)                                  | Verified-only secret scan; very low false-positive rate. **Escape hatch**: per-tool ignore file with justification.        |
| `gitleaks (secret scan, PR)`                                            | [`quality.yml`](../../.github/workflows/quality.yml)                                  | Pattern-based secret scan; SARIF report uploaded to Code Scanning. **Escape hatch**: per-tool ignore file with justification. |
| `Coverage baseline (-2pp per workspace, ADR-015)`                       | [`quality.yml`](../../.github/workflows/quality.yml)                                  | Per-workspace coverage floor (`current − 2pp`). **Escape hatch**: `pnpm run coverage:update` with rationale in commit body. |
| `CRAP baseline (relative-5% per method, ADR-018)`                       | [`quality.yml`](../../.github/workflows/quality.yml)                                  | Per-function CRAP ratchet (5% relative tolerance). **Escape hatch**: `pnpm run crap:update`.                               |
| `Maintainability baseline (rollup `*` min ≥ 70, ADR-019)`               | [`quality.yml`](../../.github/workflows/quality.yml)                                  | Framework-default MI floor on the whole-repo rollup. **Escape hatch**: `pnpm run maintainability:update`.                  |
| `Bundle-size baseline (1 MiB Worker cap + per-bundle gzippedKb, ADR-014)` | [`quality.yml`](../../.github/workflows/quality.yml)                                | 1 MiB Worker cap non-negotiable (warn at 90%, fail at 100%); per-bundle gzippedKb budgets via `size-limit`. **Bumps require paired `rationale` per [ADR-014](../decisions.md).** |
| `Lint step definitions`                                                 | [`quality.yml`](../../.github/workflows/quality.yml)                                  | BDD step-vocabulary linter; forbids duplicate phrases and unused steps.                                                    |
| `Acceptance smoke (@smoke)`                                             | [`quality.yml`](../../.github/workflows/quality.yml)                                  | Single Playwright-bdd `@smoke` scenario; fast user-journey gate.                                                           |
| `Guard destructive migrations`                                          | [`migration-label-guard.yml`](../../.github/workflows/migration-label-guard.yml)      | Blocks destructive migration diffs lacking the `migration::destructive` label.                                             |

**Out of scope for PR-blocking** (run nightly only, per the Epic #6
non-goals): `Mutation baseline` and `Lighthouse baseline`. Both run
under [`nightly.yml`](../../.github/workflows/nightly.yml) against
their recorded per-workspace / per-route baselines; regressions surface
in the nightly report rather than blocking individual PRs.

#### Re-applying the rule via the API

The exact JSON used to apply the rule is preserved at
[`main-protection.json`](./main-protection.json). To re-apply
identically:

```bash
gh api -X PUT repos/<owner>/<repo>/branches/main/protection \
  --input docs/runbooks/main-protection.json
```

This is also the canonical procedure for adding a new required check:
amend the JSON file in the same PR that introduces the workflow, then
the operator runs the `gh api` call after merge.

### 2. Pull-request review rules

- **Require a pull request before merging:** on.
- **Require approvals:** 1 minimum.
- **Dismiss stale pull request approvals when new commits are pushed:**
  on.
- **Require review from Code Owners:** off (no `CODEOWNERS` file at this
  stage; revisit when one lands).
- **Require approval of the most recent reviewable push:** on.

### 3. Conversation resolution & linear history

- **Require conversation resolution before merging:** on.
- **Require linear history:** on. Squash-merge is the project default
  ([`.agents/rules/git-conventions.md`](../../.agents/rules/git-conventions.md));
  this rule prevents stray merge commits from sneaking onto `main`.

### 4. Force pushes & deletion

- **Allow force pushes:** off (no exceptions).
- **Allow deletions:** off.

### 5. Administrators

- **Do not allow bypassing the above settings:** on. Admins are subject
  to the same gates. Bypass requires temporarily disabling the rule via
  the UI, which is auditable.

---

## Production Environment reviewer rule

Branch protection on `main` is **not** the gate between `main` and a
production deploy — that gate lives on the `production` GitHub
**Environment**. The Environment carries the human-approval rule that
[`docs/decisions.md` § ADR-013](../decisions.md) requires.

Apply via **Settings → Environments → `production`**:

- **Required reviewers:** at least one named operator
  (`@dsj1984` is the current operator of record; see
  [`.agentrc.json`](../../.agentrc.json) `github.operatorHandle`).
- **Wait timer:** 0 minutes (manual approval is the gate; no
  cool-down).
- **Deployment branches:** restrict to `main` only. Production deploys
  MUST originate from a `main` SHA; this prevents an operator from
  dispatching `deploy-production.yml` against an arbitrary branch.
- **Environment Secrets:** production credentials
  (`CLOUDFLARE_API_TOKEN`, `SENTRY_AUTH_TOKEN`, database URLs, etc.)
  live here exclusively. Repo-level Secrets MUST NOT carry
  production values.

The pairing is intentional: branch protection keeps bad code off
`main`; the Environment reviewer rule keeps `main` code from reaching
production without a named human approver.

---

## Migration safety label rule

Destructive schema migrations (`DROP COLUMN`, `RENAME`, `NOT NULL`
ADD against a populated column) require the **`migration::destructive`**
PR label. The
[`migration-label-guard`](../../.github/workflows/migration-label-guard.yml)
workflow (required check above) fails the PR if a destructive diff
lands without the label.

### One-time label bootstrap

The label is created once per repo. If it does not yet exist (verify
with `gh label list | grep migration::destructive`), create it with the
canonical color and description:

```bash
gh label create migration::destructive \
  --color D93F0B \
  --description "PR touches a destructive migration (DROP / RENAME / NOT NULL ADD) — second-approver required"
```

- **Color (`D93F0B`)** — the GitHub "red" used elsewhere on the repo for
  blocking / high-severity labels. The guard workflow does **not** match
  on color (it matches on the exact name), but keeping the color stable
  preserves the visual signal across PR listings.
- **Description** — surfaced in the GitHub label picker. The exact text
  above is what `README.md` § "Destructive migrations" points authors
  at; keep them in sync if either is edited.

### Reviewer discipline

When the `migration::destructive` label is present on a PR, a second
named approver is expected before merge. GitHub's branch-protection
"approval count" cannot conditionally bump for one label, so this rule
is documented in
[`README.md` § "Destructive migrations"](../../README.md#destructive-migrations)
and enforced procedurally rather than mechanically. The label's purpose
is to make the impact category **visible** to the first reviewer, who
escalates explicitly.

---

## Verification

After applying the rules, confirm the configuration end-to-end:

1. Open the repo's **Branches** settings page and confirm the `main`
   ruleset shows the two required checks above, plus PR review and
   linear-history rules.
2. Open **Environments → `production`** and confirm the required
   reviewer, branch restriction, and at least one Environment Secret are
   present.
3. Open a throwaway PR that touches a benign file (e.g. a typo in
   `README.md`) and confirm:
   - `quality` is listed under "Required status checks".
   - `migration-label-guard` runs and passes (no migration diff).
   - Merge is blocked until the check completes and an approval is
     recorded.
4. Confirm `gh label list | grep migration::destructive` returns the
   label.

If any step fails, **stop** — the protection rule is incomplete and
`main` is unprotected against the class of regression that rule
defends. Re-walk the section that did not verify before closing the
runbook task.

---

## Change procedure

To **add** a required check:

1. Land the workflow in a PR (the workflow must run green on its
   introducing PR — required checks cannot be added if they have never
   run).
2. In the **same PR**, append the new row to the "Required status
   checks" table above.
3. After the PR merges, an admin adds the check to the `main` ruleset
   via the UI.

To **remove** a required check, reverse the order: remove the rule
first, then delete the workflow + table row in a follow-on PR. This
prevents a window where the workflow is gone but the rule still
references it (which surfaces as `pending` forever on every new PR).

---

## Related references

- [`.github/workflows/quality.yml`](../../.github/workflows/quality.yml)
  — the canonical PR quality gate (Epic #2).
- [`docs/decisions.md`](../decisions.md) — ADR-013 (deploy promotion)
  and the migration-safety ADR that this runbook operationalizes.
- [`.agents/rules/git-conventions.md`](../../.agents/rules/git-conventions.md)
  — squash-merge default and Conventional Commits requirement.
- [`.agents/rules/security-baseline.md`](../../.agents/rules/security-baseline.md)
  — secret-isolation rules that the production Environment enforces.
