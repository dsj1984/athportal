# ADR 0004 — Email capture mechanism for observability acceptance scenarios

**Status:** Accepted (2026-05-18, Story #307)

**ADRs that govern the surface this decision lives on:**

- [ADR-012 — Observability vendor stack (MVP beta)](../decisions.md#adr-012--observability-vendor-stack-mvp-beta)
- [ADR-009 — Adopt BDD/Gherkin acceptance layer + three-tier testing pyramid](../decisions.md#adr-009--adopt-bddgherkin-acceptance-layer--three-tier-testing-pyramid)

## Context

Epic #5 landed seven `.feature` files under
[`tests/features/observability/`](../../tests/features/observability/)
covering AC-1 through AC-7. Five of the twelve scenarios assert "the
operator receives an alert email naming X" — the user-visible outcome of
the alert path wired through Sentry (AC-1, AC-4), Better Stack uptime
(AC-3), and the vendor-native budget alerts (AC-5). One scenario asserts
the inverse ("no alert email is delivered to the operator") when the
synthetic-failure rehearsal switch is off.

The alert emails themselves originate **from third-party SaaS** (Sentry
servers, Better Stack servers). Our application never sends them; we
only wire the alert path that the vendor renders into an email. That
constraint shapes every option below — the assertion the acceptance
tier can hermetically defend is "the alert path is wired", **not** "the
vendor's SMTP server delivered an email". The contract tier already
covers wire shape (sourcemap upload action's gate, redaction allowlist
sets, uptime-probe YAML structure); this ADR picks the email-capture
mechanism that lets the acceptance tier defend the rest of the
user-visible outcome offline.

The Story brief named two candidates: an ephemeral SMTP catcher
(Mailpit container) and an in-memory fake injected at the
alert-routing boundary. The decision drives the shape of every step
phrase that says "the operator receives an alert email".

## Decision

**Adopt an in-memory `EmailInbox` fixture at
[`apps/web/e2e/fixtures/email-inbox.ts`](../../apps/web/e2e/fixtures/email-inbox.ts).**

The fixture is a per-test in-process map of `{ subject, body, vendor }`
records pushed by the observability helpers
([`apps/web/e2e/helpers/observability/`](../../apps/web/e2e/helpers/observability/)).
Each helper synthesises the message the vendor *would* send by reading
the actual in-repo configuration — `betterstack.yml` for probe alerts,
[`observability-budget.md`](../ops/observability-budget.md) for budget
alerts, the `OBSERVABILITY_SYNTHETIC_FAILURE_ENABLED` env flag for the
rehearsal switch — so a misconfigured vendor wiring (a missing probe in
the YAML, a renamed env flag) fails the acceptance test for the same
reason it would silence a real alert in staging.

The inbox is cleared between scenarios so state never leaks. Steps that
assert delivery (`the operator receives an alert email naming X`) match
against the inbox; steps that assert non-delivery
(`no alert email is delivered to the operator`) assert the inbox is
empty for the run.

## Rationale matrix

| Concern | In-memory fake (chosen) | Mailpit container (rejected) |
| --- | --- | --- |
| **CI cost** | Zero. Runs in the existing acceptance job; no Docker image to pull, no port to expose. | Adds a container start to every PR run; a 20–40s overhead and an extra failure mode (port collision, image-registry outage). |
| **Fidelity to vendor-native email** | Identical: in both cases the vendor SMTP is **not** exercised. Mailpit catches what *we* send, not what *Sentry* sends; the same wiring-correctness assertion is the ceiling for both designs. | No higher than the in-memory fake. The vendor emails the operator from SaaS; we cannot route those to a local SMTP catcher without standing up a real Sentry/Better Stack account in CI. |
| **Secret surface** | None. The fixture is a `Map<string, EmailRecord[]>` in a Node process. | Requires a fake-SMTP credential pair if the vendor SDK demands one in its config validation. Even when the credentials are dummies, they are one more committed surface to maintain. |
| **Determinism** | Fully deterministic — no async I/O, no port binding, no clock skew. | Susceptible to start-up races (`waitForServer(smtp://localhost:1025)`) and shutdown leaks between projects. |
| **Step-body shape** | Steps call `inbox.find({ vendor: 'sentry', namesRuntime: 'Workers' })` — boundary stays inside the trust line per the assertion-placement rule. | Steps would HTTP-fetch the Mailpit API (`GET /api/v1/messages`) — a `/api/` URL literal which the step-definition linter forbids ([`scripts/lint-steps.mjs`](../../scripts/lint-steps.mjs) § `no-api-url-literal`). A workaround is possible but introduces a deliberate carve-out we'd have to defend. |
| **What you give up** | Cannot exercise the vendor's templating, retry, or rate-limit logic. That logic lives at the vendor's edge — out of scope for any local acceptance tier. | Same as in-memory fake (the vendor SMTP is still not exercised) plus the CI cost and lint friction above. |

The fidelity gap between the two options is **zero** for the assertions
the acceptance tier needs to make. The cost gap is non-trivial. The
in-memory fake wins on every axis that matters.

## Implementation contract

- The fixture exposes a module-scope singleton `emailInbox` and a
  matching `logSink` for AC-2's request-completion logging assertion.
  Both expose `push()`, `findAll(predicate)`, `reset()`.
- The helpers under
  [`apps/web/e2e/helpers/observability/`](../../apps/web/e2e/helpers/observability/)
  read the **live** in-repo configuration when synthesising a message
  (e.g. the probe helper parses
  [`infra/uptime/betterstack.yml`](../../infra/uptime/betterstack.yml) to
  resolve probe names; the budget helper parses
  [`observability-budget.md`](../ops/observability-budget.md) to confirm
  the vendor row exists). A drift between the configuration and the
  helper expectation fails the acceptance test — that is the
  mechanical gate this ADR depends on.
- Step bodies in
  [`apps/web/e2e/steps/observability.steps.ts`](../../apps/web/e2e/steps/observability.steps.ts)
  call the helpers and read the inbox; they never embed `/api/` URL
  literals, HTTP status codes, DOM selectors, or raw SQL, per
  [`scripts/lint-steps.mjs`](../../scripts/lint-steps.mjs) § Forbidden
  patterns.
- Scenarios that cannot be defended hermetically (e.g. the real Sentry
  permalink shape after a staging deploy) document the staging-env gate
  in the runbook rather than smuggling the assertion into the in-memory
  fixture. AC-1 / AC-4 cover the permalink shape via a synthetic
  Sentry-style URL pattern; the contract-tier assertion (a real
  sourcemap-resolved frame) lives on the staging deploy path and is
  not in scope for this tier.

## Consequences

- Acceptance scenarios for the observability vendor stack run offline.
  The CI job retains the existing `acceptance-smoke (@smoke)` gate and
  picks up an additional matrix of `@ac-N`-tagged scenarios under the
  nightly `Acceptance full` schedule.
- Adding a new observability vendor (per ADR-012's per-Story migration
  cost) requires three paired changes: a new row in the budget runbook,
  a new helper or extension under
  [`apps/web/e2e/helpers/observability/`](../../apps/web/e2e/helpers/observability/),
  and a paired `.feature` scenario. The fixture itself does not need to
  change.
- The in-memory fixture is **not** a substitute for the staging-env
  vendor-native alert configuration. Each vendor row in the budget
  runbook still carries a "Configured on (UTC)" audit timestamp; the
  helpers verify wiring, the audit row verifies the vendor console.
- If a future scenario genuinely needs to assert against a vendor SMTP
  payload (templating regressions, attachment shape), a supplementary
  Mailpit-style harness can be added without rewriting the in-memory
  fixture. That is a Day N decision, not a Day 1 cost.

## Rejected — ephemeral SMTP catcher (Mailpit container)

- Adds CI cost (container start, image pull, port binding) and a new
  failure mode for every PR run without raising the fidelity of any
  assertion the acceptance tier needs to defend.
- Forces step bodies to HTTP-fetch the catcher's REST API
  (`GET /api/v1/messages` or `GET /api/v2/...`), which collides with
  the step-definition linter's `no-api-url-literal` rule and would
  require a documented carve-out.
- Does not solve the underlying constraint that the vendor emails
  themselves come from SaaS infrastructure we do not control in CI.

## Related

- [`docs/testing-strategy.md`](../testing-strategy.md) — three-tier
  pyramid and the assertion-placement rule.
- [`.agents/rules/gherkin-standards.md`](../../.agents/rules/gherkin-standards.md)
  — forbidden patterns in `.feature` files.
- [`scripts/lint-steps.mjs`](../../scripts/lint-steps.mjs) — the
  step-definition linter that the in-memory design satisfies and the
  Mailpit design would have to carve around.
- Epic #5 Acceptance Spec — Issue #247 (canonical AC IDs).
