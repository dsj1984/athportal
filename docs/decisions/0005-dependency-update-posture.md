# ADR 0005 — Dependency update posture

**Status:** Accepted (2026-05-18, Story #311)

**ADRs that govern the surface this decision lives on:**

- [ADR-011 — Supply-chain CVE gate is a required check](../decisions.md#adr-011--supply-chain-cve-gate-is-a-required-check)

## Context

[ADR-011](../decisions.md#adr-011--supply-chain-cve-gate-is-a-required-check)
established the supply-chain CVE gate — `pnpm audit` blocks `main` on
unsuppressed High / Critical advisories in the production graph. That
gate is reactive: it fires when an advisory is already published against
a dependency that is already in the lockfile. It does not pull patch /
minor / major updates forward on its own, and it does not refresh the
`pnpm-lock.yaml` solver on a schedule.

Without a scheduled update mechanism, the responsibility for staying
current with upstream releases falls on whoever notices a CVE alert or
spots a deprecation warning in CI output. For a small-team project
that means updates land in irregular bursts (typically right after a
visible CVE) rather than as a steady weekly ratchet — exactly the
posture where a transitive vulnerability is most likely to sit
unfixed long enough to become reachable.

The sister project [domio](https://github.com/dsj1984/domio) ships
[a Renovate configuration](https://github.com/dsj1984/domio/blob/main/renovate.json)
covering the same vendor surface this repo carries (Astro, Sentry,
ESLint, Vitest, Cloudflare, Playwright). The configuration is mature,
the operator posture is proven, and the same "grouped weekly PR
review session" rhythm fits this project's small-team posture.

The dimension this ADR locks down is **how updates land**:

- Which bot opens the PRs (Renovate vs. Dependabot vs. manual).
- When the PRs land (continuously vs. batched).
- Which updates auto-merge and which require human approval.
- What triggers an out-of-band update outside the normal window.

The dimension this ADR does **not** cover is **which versions are
allowed** — that remains [ADR-011](../decisions.md#adr-011--supply-chain-cve-gate-is-a-required-check)'s
job. Renovate proposes the update; the CVE gate decides whether the
proposed update is safe to ship.

## Decision

- **Adopt [Renovate](https://docs.renovatebot.com/) as the scheduled
  dependency-update bot**, installed as a GitHub App against
  `dsj1984/athportal` only (no organization-wide install). The
  declarative configuration lives at
  [`renovate.json`](../../renovate.json) at the repository root.
- **The weekly window is Monday morning, America/New_York.** Renovate
  fires grouped PRs at `before 9am on monday`; the review queue
  surfaces in a single sitting at the start of the work week rather
  than draining the operator's attention continuously through the
  week. `lockFileMaintenance` refreshes `pnpm-lock.yaml` in the same
  window.
- **Vulnerability alerts run out-of-band.** Renovate's
  `vulnerabilityAlerts` block schedules `at any time` — a published
  High / Critical advisory does not wait for the next Monday window
  to surface as a PR. The CVE gate from
  [ADR-011](../decisions.md#adr-011--supply-chain-cve-gate-is-a-required-check)
  still has the final word on whether the resulting update ships.
- **Patch and minor updates auto-merge; major updates require operator
  approval.** Patch / minor PRs carry `automerge: true`; once the
  required CI checks turn green, GitHub native auto-merge squash-merges
  the PR. Major-version PRs carry `automerge: false` and
  `dependencyDashboardApproval: true` — they sit on the Dependency
  Dashboard until the operator explicitly ticks the approval checkbox.
- **Packages are grouped by vendor family**, not by ecosystem default.
  One PR per family per week reduces ~30 ungrouped PRs to ~5–8 review
  units across the project's actual dependency graph. Declared groups
  match the families the project currently uses or has committed
  to in foundation Epics:
  Astro, Sentry, Cloudflare / Hono, ESLint, Biome, Vitest, Playwright,
  Expo, Husky / lint-staged. New families land in the same
  [`renovate.json`](../../renovate.json) as they are introduced.
- **Concurrency is bounded.** `prConcurrentLimit: 15` and
  `prHourlyLimit: 4` cap the open-PR surface so a Monday firing
  cannot swamp the review queue or saturate CI runners.
- **The operator setup is procedural, not automated.** The PR that
  lands this ADR also lands the configuration; activation requires
  the operator to install the Renovate GitHub App, scope it to this
  repository, and enable repository auto-merge. The procedure lives
  in [`docs/ops/dependency-update-runbook.md`](../ops/dependency-update-runbook.md)
  and is the single source of truth — the Story body that introduced
  this ADR mirrors the steps verbatim so the runbook stays the
  reference document.

## Rationale matrix

| Concern | Renovate (chosen) | Dependabot (rejected) |
| --- | --- | --- |
| **PR volume per week** | ~5–8 grouped PRs (one per vendor family) across the current dependency graph. | ~30 individual PRs (one per package). Saturates the review queue and pushes CI runner cost. |
| **Lockfile refresh** | `lockFileMaintenance` re-resolves `pnpm-lock.yaml` on the same weekly schedule, surfacing transitive drift even when no direct dependency changed. | No native lockfile-only PR. Drift accumulates silently between direct-dependency PRs. |
| **Schedule control** | First-class `schedule` field with cron-like windows; batches the week's work into one review session. | Fires immediately on every upstream release; no batching primitive. |
| **Dashboard surface** | Single `Dependency Dashboard` issue summarising every pending update, including major-version PRs awaiting approval. | No equivalent. Each update is independent; queue-level visibility requires manual inspection of the PR list. |
| **Group declarations** | `packageRules[].groupName` + `matchPackageNames` (glob) declaratively groups by vendor family. | `groups` block exists but requires regex-style patterns and does not fold lockfile maintenance into the same primitive. |
| **Sister-project precedent** | Live in [domio](https://github.com/dsj1984/domio/blob/main/renovate.json) against the same vendor surface; the configuration is a fork-and-tune from a proven baseline. | No precedent in adjacent projects; configuration would be new work without a reference. |

The PR-volume gap is the load-bearing argument: at ~30 ungrouped PRs
per Monday, the operator's review attention is the bottleneck — bumping
either of the two practical update paths (patch automerge, major-with-approval)
into the operator's queue at that volume turns the gate into noise.
Renovate's grouping primitive collapses the volume to one review
session per week, which is what makes the automerge posture safe to
default to `true`.

## Configuration contract

The committed [`renovate.json`](../../renovate.json) follows this
shape; the live file is canonical and supersedes any prose drift in
this ADR.

- `extends: ["config:recommended", ":dependencyDashboard"]` —
  Renovate's recommended preset plus the Dependency Dashboard issue
  emission.
- `schedule: ["before 9am on monday"]` and `timezone: "America/New_York"` —
  the weekly window named in the Decision.
- `platformAutomerge: true` — Renovate hands the merge to GitHub native
  auto-merge once required checks are green. Mirrors the
  `single-story-deliver` close path.
- `prConcurrentLimit: 15`, `prHourlyLimit: 4` — bounded review surface.
- `lockFileMaintenance.enabled: true` with the same weekly window —
  transitive refresh runs in the same review session.
- `vulnerabilityAlerts.schedule: ["at any time"]` with a `security`
  label — out-of-band path for High / Critical CVEs.
- `packageRules`:
  - Catch-all `matchUpdateTypes: ["patch", "minor"]` →
    `automerge: true`.
  - Catch-all `matchUpdateTypes: ["major"]` → `automerge: false`,
    `dependencyDashboardApproval: true`.
  - One vendor-family group per declared family (see Decision).
  - `matchManagers: ["nvm"]` → `automerge: false` for Node.js itself
    (runtime bumps are operator-driven).

## Out-of-band update triggers

Two paths land updates outside the Monday window:

1. **Renovate `vulnerabilityAlerts` fires on a published High /
   Critical advisory.** The PR opens immediately, carrying the
   `security` label and grouping rules from the matching vendor
   family. The patch / minor automerge rule still applies — if the
   advisory has a patched upstream version available and the update
   is patch / minor, the PR auto-merges on green CI. If it is major,
   the PR sits on the Dashboard for operator approval.
2. **The [ADR-011](../decisions.md#adr-011--supply-chain-cve-gate-is-a-required-check)
   CVE gate fails a PR on `main`.** This is the reactive surface
   Renovate's scheduled posture is designed to minimise — a PR
   failing the CVE gate post-merge means a vulnerability landed in
   the production graph between Monday windows. The remediation
   path is the same as before this ADR: either land an upstream
   fix as a `pnpm.overrides` entry, or document a suppression in
   `scripts/audit-check.mjs`'s `IGNORED` map per ADR-011. Renovate
   does not change the CVE gate's behaviour.

## Consequences

- **Auto-merge is the default surface.** Patch and minor PRs land
  without operator intervention once CI is green. The operator's
  review time is spent on major-version PRs and on the rare
  patch / minor PR that fails CI (a flaky test, a coverage regression,
  a baseline ratchet failure). This is the same posture
  [`single-story-deliver`](../../.agents/workflows/helpers/single-story-deliver.md)
  uses for human-authored PRs and is the load-bearing reason the
  weekly volume stays reviewable.
- **A vendor family that introduces a breaking change as a "minor"
  release** — the SemVer-vs-actual-semantics gap — will land via
  auto-merge. The CVE gate catches security drift; the lint, type,
  test, and baseline-ratchet jobs from
  [`quality.yml`](../../.github/workflows/quality.yml) catch
  surface-level regressions; nothing catches a vendor's silent
  breaking-change-disguised-as-minor at the wire level. The
  mitigation is the existing quality-gate stack, not a config
  change here — the Renovate posture trusts the SemVer contract
  and falls back to the gate stack when the contract breaks.
- **Repository auto-merge MUST be enabled on GitHub** for
  `platformAutomerge: true` to land patch / minor updates without
  operator clicks. The runbook names this as the load-bearing
  one-time setup step alongside the Renovate App install.
- **The configuration file is the source of truth.** Adding a new
  vendor family — Stripe, Mux, Drizzle Kit, a future analytics SDK —
  is a single-file PR against [`renovate.json`](../../renovate.json).
  The ADR does not need to be re-ratified for additive group changes;
  it does need to be re-ratified (or superseded) if the policy
  surface itself shifts (automerge scope, schedule cadence, manual
  vs. bot bot, dropping vulnerability-alert out-of-band path).
- **Major-version PRs accumulate on the Dependency Dashboard until
  the operator approves them.** This is intentional — the
  Dashboard is the review queue. Letting majors auto-merge would
  reintroduce the exact noise-floor problem the per-family grouping
  is meant to solve at minor scope.

## Rejected — Dependabot as the scheduled bot

- **PR volume.** Without lockfile-aware grouping at the same fidelity
  as Renovate's, Dependabot's per-package PR cadence saturates the
  review queue at the volume the current dependency graph already
  carries.
- **No lockfile-maintenance primitive.** Transitive drift between
  direct-dependency PRs accumulates silently. The CVE gate catches
  the worst case (a transitive High / Critical), but routine
  freshness gets no scheduled touch.
- **No Dependency Dashboard.** Queue-level visibility lives in the
  PR list, which mixes Dependabot output with human PRs and makes
  the major-version approval surface invisible.
- **Mirrors the sister-project posture.** [domio](https://github.com/dsj1984/domio)
  shipped Renovate for the same reasons against the same vendor surface;
  re-deciding the bot for this project would split operator muscle
  memory across two repositories with no benefit.

## Rejected — manual updates driven by CVE alerts only

The pre-ADR baseline. Catches security regressions reactively (the
CVE gate fires, the operator opens a PR), misses routine freshness
entirely. Treats every patch / minor update as operator-initiated
work, which is exactly the volume problem the automerge posture is
designed to eliminate.

## Related

- [ADR-011 — Supply-chain CVE gate](../decisions.md#adr-011--supply-chain-cve-gate-is-a-required-check)
  — the security gate Renovate proposes updates against.
- [`renovate.json`](../../renovate.json) — the live configuration.
- [`docs/ops/dependency-update-runbook.md`](../ops/dependency-update-runbook.md)
  — operator setup procedure (Renovate App install, repository
  auto-merge enablement, first-run verification).
- [domio renovate.json](https://github.com/dsj1984/domio/blob/main/renovate.json)
  — sister-project reference configuration.
