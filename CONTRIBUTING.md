# Contributing to athportal

Thanks for contributing. This guide focuses on the **non-mechanical**
expectations — branch protection, linters, and conventional-commit checks
are enforced automatically and don't need re-documenting here. What
follows is what a reviewer is going to look for that **cannot** be
encoded in CI.

For the day-to-day mechanics (workspace layout, lint baseline, commit
hooks, CI gates), read [`AGENTS.md`](./AGENTS.md) and the
[`docs/`](./docs) tree.

---

## Pull request basics

- Use Conventional Commits in PR titles. The squash-merge title becomes
  the commit on `main`, so `release-please` needs it to parse cleanly.
  See [`.agents/rules/git-conventions.md`](./.agents/rules/git-conventions.md).
- Reference the issue you're closing in the PR body
  (`Resolves #N` / `Closes #N`).
- Keep PRs scoped to one logical change. The lint baseline ratchet, the
  unified-baselines gate, and the quality CI all run on every PR — a
  sprawling PR pays those costs once per concern instead of once.

---

## Destructive migrations

Schema changes are the highest-risk class of change in this repo because
they cannot be rolled back by `wrangler rollback` once the database has
applied them. Any PR that touches a Drizzle migration file under
`apps/api/**/migrations/**` (path will solidify when the API workspace
lands; see [`docs/architecture.md`](./docs/architecture.md)) and adds a
`DROP`, `RENAME`, or `NOT NULL ADD` clause is **destructive** and the
following rules apply.

### The `migration::destructive` label

- The author MUST apply the **`migration::destructive`** PR label.
- The label exists for two reasons:
  1. It makes the impact category **visible to the first reviewer**
     before they open the diff.
  2. It is the signal the `migration-label-guard` workflow uses to
     allow the destructive diff through. PRs that touch a destructive
     migration without the label fail the required check and cannot
     merge.
- One-time bootstrap of the label (operator-only, documented in the
  [branch-protection setup runbook](./docs/runbooks/branch-protection-setup.md#one-time-label-bootstrap)):
  ```bash
  gh label create migration::destructive \
    --color D93F0B \
    --description "PR touches a destructive migration (DROP / RENAME / NOT NULL ADD) — second-approver required"
  ```

### The two-reviewer rule

When the `migration::destructive` label is present on a PR, the merge
gate is **two named approvers**, not one. GitHub's branch-protection
rule cannot conditionally bump the required-approval count for a single
label, so this rule is enforced **procedurally**, not mechanically:

- The first reviewer approves on the change's general merit.
- The first reviewer is responsible for explicitly **escalating** to a
  second reviewer (by `@`-mention in a PR comment) before merging.
- The second reviewer's approval is what unlocks the merge.

The PR author MUST NOT self-merge a `migration::destructive` PR even if
GitHub's UI offers the button. If the second approval is missing, wait.

### Why the ADR matters

The policy above is recorded as an Architecture Decision Record in
[`docs/decisions.md`](./docs/decisions.md). Read the ADR before
proposing changes to the destructive-migration policy itself — the
rationale (rollback irreversibility, the guard-workflow contract, the
two-reviewer escalation pattern) is captured there and changes to the
policy require superseding the ADR, not just editing this file.

---

## Where else to look

- [`AGENTS.md`](./AGENTS.md) — project status, toolchain, and the
  always-loaded agent rule set.
- [`docs/architecture.md`](./docs/architecture.md) — tech-stack
  decisions and the `/api/v1` route-mount convention.
- [`docs/patterns.md`](./docs/patterns.md) — repeating code patterns
  (lint baseline ratchet runbook, Biome ↔ ESLint scope boundary).
- [`docs/testing-strategy.md`](./docs/testing-strategy.md) — the
  three-tier pyramid and the assertion-placement rule.
- [`docs/runbooks/`](./docs/runbooks/) — operational procedures
  (branch protection, rollback paths).
