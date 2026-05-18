# Dependency Update Runbook — Renovate Setup and Operation

> **Status:** Authoritative operator procedure for activating and
> operating the Renovate dependency-update posture.
> **ADR:** [ADR 0005 — Dependency update posture](../decisions/0005-dependency-update-posture.md),
> [ADR-011 — Supply-chain CVE gate](../decisions.md#adr-011--supply-chain-cve-gate-is-a-required-check).
> **Configuration:** [`renovate.json`](../../renovate.json).

## Audience and scope

This runbook is the single setup-and-operation handbook for the
Renovate GitHub App against `dsj1984/athportal`. It assumes the
operator has admin access to the repository (required to install a
GitHub App and edit branch-protection / general settings) and an
account with permission to install GitHub Apps to the `dsj1984`
namespace. It covers MVP-beta posture only — group widening,
allow-list extensions, and schedule changes are documented in
[ADR 0005](../decisions/0005-dependency-update-posture.md) and land
as configuration PRs against [`renovate.json`](../../renovate.json),
not as runbook edits.

## What Renovate does, in one paragraph

Renovate is a GitHub App that, on the schedule declared in
[`renovate.json`](../../renovate.json), opens grouped pull requests
that bump dependency versions, refreshes the `pnpm-lock.yaml`
solver, and posts a single `Dependency Dashboard` issue listing
every pending update. Patch / minor updates auto-merge once the
required CI checks turn green; major-version updates sit on the
Dashboard until the operator ticks an approval checkbox. Published
High / Critical CVEs surface as out-of-band PRs without waiting for
the next weekly window. The bot does not modify the
[ADR-011 CVE gate](../decisions.md#adr-011--supply-chain-cve-gate-is-a-required-check) —
it proposes updates; the CVE gate decides whether they ship.

## Operator manual steps (MUST be done by the operator on GitHub — cannot be automated by the PR)

Run these AFTER the PR for this Story merges to `main`:

1. **Install the Renovate GitHub App.** Open <https://github.com/apps/renovate> in a browser while signed in as the `dsj1984` account.
2. **Click "Configure"** (top-right). On the "Install Renovate" page, select `dsj1984` (your user account).
3. **Select repositories.** Choose **"Only select repositories"** (do NOT pick "All repositories" — limit scope explicitly). In the dropdown, check `dsj1984/athportal`.
4. **Click "Install"** (or "Save" if Renovate is already installed on other repos and you're just adding this one). GitHub will redirect back to Renovate's dashboard.
5. **Verify the first Dependency Dashboard issue lands.** Within ~10 minutes of installation, Renovate opens an onboarding PR titled "Configure Renovate" against `main`. Review the body — it lists every package Renovate plans to manage and how it interpreted `renovate.json`. **Merge the onboarding PR** to activate the configuration.
6. **Confirm the Dashboard.** Visit [https://github.com/dsj1984/athportal/issues](https://github.com/dsj1984/athportal/issues) and confirm an issue titled "Dependency Dashboard" exists, owned by `renovate[bot]`. This is the live view of everything Renovate has queued.
7. **Enable repository auto-merge** (one-time prerequisite for `platformAutomerge: true`):
   - Settings → General → Pull Requests section
   - Tick **"Allow auto-merge"** (if not already on)
   - Tick **"Automatically delete head branches"** (if not already on, so Renovate's merged PR branches get cleaned up)
   - Click Save
8. **Optional — branch protection.** If `main` has required status checks, confirm Renovate's bot is allowed to merge them. Settings → Branches → `main` rule → ensure "Restrict who can push" either includes `renovate[bot]` or is off entirely. Patch/minor automerge will silently no-op otherwise.
9. **Sanity check after first Monday window.** The Monday after install, confirm 1-5 grouped PRs appear on the Pull Requests tab. If you see ungrouped individual PRs (e.g. one per `@sentry/*` package), the `packageRules` matchers in `renovate.json` need tuning — open a follow-up PR.

## Day-to-day operation

### Reviewing the weekly PR set

Every Monday before 9am ET, expect 1–5 grouped PRs and (if the
solver finds drift) one `lockFileMaintenance` PR. Each PR carries
the vendor-family group name in its title (e.g. `Update Sentry`,
`Update ESLint`). Per [ADR 0005](../decisions/0005-dependency-update-posture.md):

- **Patch / minor PRs**: auto-merge fires once required CI checks
  pass. No operator click required. If a PR sits in the queue with
  a failed check, treat it like any other failing PR — the failing
  job log is the diagnostic surface.
- **`lockFileMaintenance` PR**: refreshes `pnpm-lock.yaml`
  resolutions for transitive dependencies without bumping any
  declared version. Auto-merges on green per the patch / minor
  rule.

### Approving a major-version PR

Major-version PRs do **not** auto-merge. They appear on the
Dependency Dashboard issue under "Pending Approval" with an
unchecked checkbox.

1. Open the Dependency Dashboard issue
   (`https://github.com/dsj1984/athportal/issues` → filter by
   `renovate[bot]`).
2. Read the upstream changelog for the major version. Renovate
   links it in the PR body it will open once approved.
3. Tick the checkbox next to the major-version entry. Renovate
   opens (or re-opens) the PR within ~10 minutes.
4. Review the diff. Land the PR like any human-authored PR:
   confirm CI is green, then squash-merge through the GitHub UI.
   `platformAutomerge: true` does **not** auto-merge a major PR
   (its `packageRules` block sets `automerge: false`).

### Out-of-band vulnerability alerts

When a published High / Critical advisory lands against a
dependency in the lockfile, Renovate opens a PR immediately
(any time of day, any day of the week), carrying the `security`
label. The patch / minor auto-merge rule still applies — most
security PRs are patch / minor and will auto-merge on green CI
without operator intervention.

If the advisory has no patched upstream version available, the
PR will not propose an update; the `Dependency Dashboard` issue
will list the advisory in its "Vulnerabilities" section. The
remediation paths in that case are the same as before Renovate
landed — either a `pnpm.overrides` entry pinning a fixed
transitive, or an `IGNORED` map entry in
[`scripts/audit-check.mjs`](../../scripts/audit-check.mjs) per
[ADR-011](../decisions.md#adr-011--supply-chain-cve-gate-is-a-required-check),
including the required `reason` and `revisit` fields.

## Configuration changes

Every change to the Renovate posture lands as a PR against
[`renovate.json`](../../renovate.json). Common cases:

- **Add a new vendor-family group** when the project introduces a
  new dependency family (e.g. Stripe, Mux, Drizzle Kit). Add a new
  entry to `packageRules` with `groupName` and
  `matchPackageNames` (glob). No ADR re-ratification needed; the
  Decision in [ADR 0005](../decisions/0005-dependency-update-posture.md)
  explicitly allows additive group changes.
- **Adjust `prConcurrentLimit` / `prHourlyLimit`** if the review
  queue is consistently empty (lower limits) or consistently
  saturated (higher limits, with caution). This is a tuning knob,
  not a policy change; document the rationale in the PR body.
- **Add a per-package `automerge: false` exception** for a vendor
  family that has shipped a breaking change as a "minor" release.
  Layer the exception on top of the catch-all patch / minor rule:
  `{ "matchPackageNames": ["<package>"], "automerge": false }`
  AFTER the catch-all in the `packageRules` array. Renovate
  evaluates `packageRules` top-to-bottom; later rules override
  earlier ones.

Changes that touch the **policy surface** itself — automerge
scope, schedule cadence, dropping the vulnerability-alerts
out-of-band path, bot replacement — require a new ADR superseding
[ADR 0005](../decisions/0005-dependency-update-posture.md). Do not
edit the ADR in place for those changes.

## Troubleshooting

### "I expected a PR this Monday but got none."

1. Open the Dependency Dashboard issue. If it lists no updates,
   no dependencies have releases pending — this is the green
   path.
2. If the Dashboard lists updates but no PRs were opened, check
   `prConcurrentLimit` and `prHourlyLimit` in
   [`renovate.json`](../../renovate.json). Renovate may already
   have hit the cap from a previous run with un-merged PRs.
3. If the Dashboard itself is missing or stale, check the
   Renovate App's logs from the GitHub App settings page (Settings
   → Integrations → Renovate → Recent Deliveries) for delivery
   failures.

### "A PR's auto-merge isn't firing despite green CI."

1. Confirm "Allow auto-merge" is still ticked under Settings →
   General → Pull Requests. A repo-level toggle disabled here
   blocks every PR's auto-merge regardless of `platformAutomerge`
   in `renovate.json`.
2. Confirm `renovate[bot]` is not restricted by the `main`
   branch protection rule under Settings → Branches.
3. Confirm the PR is not flagged as a major-version update — the
   Dependency Dashboard is the authoritative read on whether a PR
   is in the patch / minor auto-merge bucket.

### "I see ungrouped per-package PRs instead of one vendor-family PR."

The `matchPackageNames` glob for that family does not match the
package name as registered on npm. Open the PR's body to read
the exact package name Renovate parsed, then update the
matching entry in [`renovate.json`](../../renovate.json) (the
glob is case-sensitive; `@vendor/**` matches `@vendor/foo` but
not `@Vendor/foo`).

## Related

- [ADR 0005 — Dependency update posture](../decisions/0005-dependency-update-posture.md)
  — the policy this runbook operationalizes.
- [ADR-011 — Supply-chain CVE gate](../decisions.md#adr-011--supply-chain-cve-gate-is-a-required-check)
  — the security gate Renovate proposes updates against.
- [`renovate.json`](../../renovate.json) — the live configuration
  file; canonical for every behavioural question this runbook
  does not answer.
- [Renovate documentation](https://docs.renovatebot.com/) — the
  upstream reference for `packageRules` semantics, schedule
  cron grammar, and the `Dependency Dashboard` issue format.
