# Testing Strategy

> The generic tier rules live in [`.agents/rules/testing-standards.md`](../.agents/rules/testing-standards.md); this document maps those rules onto the concrete tools, paths, and workspaces this repo uses. When `AGENTS.md`, `CLAUDE.md`, or `docs/patterns.md` talk about testing, they defer to this file — do not duplicate rules across documents.
>
> The three tiers (unit, contract, acceptance) are wired today: Vitest projects run unit + contract under `pnpm run test`, the smoke acceptance scenario runs under `pnpm --filter @repo/web exec bddgen && pnpm --filter @repo/web test:e2e -- --grep @smoke`, and the step-definition linter runs under `pnpm run lint:steps`. CI ([`quality.yml`](../.github/workflows/quality.yml)) gates every PR on the three; the nightly schedule ([`nightly.yml`](../.github/workflows/nightly.yml)) runs the full acceptance corpus, the Stryker mutation report, and the full Lighthouse + bundle-size baselines.
>
> This document is the single source of truth for **what we test, how we test it, and what gates the result**. That includes the automated pyramid (unit → contract → acceptance), the quality-baseline ratchets that the pyramid runs through (coverage, CRAP, maintainability, mutation, bundle-size, Lighthouse, lint), the static-analysis gates that run alongside (dependency-cruiser, Knip, secretlint, RBAC matrix drift, step linter), and the manual-testing cadence that fills the gaps automation can't reach.

---

## Contents

- [Pyramid Sizing Today](#pyramid-sizing-today)
- [The Pyramid](#the-pyramid)
- [Decision Matrix](#decision-matrix)
- [Assertion Placement Rule](#assertion-placement-rule)
- [Per-Tier Skeletons](#per-tier-skeletons)
  - [Unit — pure function](#unit--pure-function)
  - [Unit — React component](#unit--react-component)
  - [Contract — route round-trip](#contract--route-round-trip)
    - [Authenticated routes — `createTestApp(db, { actor })`](#authenticated-routes--createtestappdb--actor-)
  - [Acceptance — user journey (Gherkin)](#acceptance--user-journey-gherkin)
- [Forbidden Patterns](#forbidden-patterns)
- [Where each tier lives (target)](#where-each-tier-lives-target)
- [Cross-platform execution *(v1.0)*](#cross-platform-execution-v10)
- [Quality Baselines & Ratchets](#quality-baselines--ratchets)
  - [Coverage baseline (ADR-015)](#coverage-baseline-adr-015)
  - [CRAP baseline (ADR-018)](#crap-baseline-adr-018)
  - [Maintainability baseline (ADR-019)](#maintainability-baseline-adr-019)
  - [Mutation testing (Stryker)](#mutation-testing-stryker)
  - [Bundle-size baseline](#bundle-size-baseline)
  - [Lighthouse baseline](#lighthouse-baseline)
  - [Lint baseline ratchet](#lint-baseline-ratchet)
- [Static Analysis Gates](#static-analysis-gates)
  - [Dependency-cruiser (architecture rules)](#dependency-cruiser-architecture-rules)
  - [Knip — dead code](#knip--dead-code)
  - [Secretlint](#secretlint)
  - [Step-definition linter](#step-definition-linter)
  - [RBAC matrix drift check](#rbac-matrix-drift-check)
- [Manual Testing](#manual-testing)
  - [What manual testing is for](#what-manual-testing-is-for)
  - [The three cadences](#the-three-cadences)
    - [Per-Story exploratory charter](#1-per-story-exploratory-charter)
    - [Per-phase regression checklist](#2-per-phase-regression-checklist)
    - [Pre-release sweep](#3-pre-release-sweep)
  - [Phase gates](#phase-gates)
  - [Devices, browsers, and personas](#devices-browsers-and-personas)
  - [Accessibility, performance, and security touchpoints](#accessibility-performance-and-security-touchpoints)
  - [Findings, triage, and closing the loop](#findings-triage-and-closing-the-loop)
  - [Regression checklist](#regression-checklist)
  - [How to update this section](#how-to-update-this-section)
- [QA Corpus](#qa-corpus)
  - [Overview](#overview)
  - [Test Plan format](#test-plan-format)
  - [Exploratory Charter format](#exploratory-charter-format)
  - [Heuristic library](#heuristic-library)
  - [Lint, index, and coverage gates](#lint-index-and-coverage-gates)
  - [Agent-runner runbook](#agent-runner-runbook)
  - [Promotion pipeline (charter finding → Test Plan / scenario)](#promotion-pipeline-charter-finding--test-plan--scenario)
  - [Safety-constraints contract](#safety-constraints-contract)
  - [Per-domain coverage floors](#per-domain-coverage-floors)
- [Coverage expectations](#coverage-expectations)
- [When to add a test vs. when to move one](#when-to-add-a-test-vs-when-to-move-one)
- [Canonical step vocabulary](#canonical-step-vocabulary)
- [Adding a new step](#adding-a-new-step)
- [How the sizing was counted](#how-the-sizing-was-counted)

---

## Pyramid Sizing Today

> *Last updated: 2026-05-25. Regenerate the counts with the commands in [§ How the sizing was counted](#how-the-sizing-was-counted) at the end of this document; update the table in the same PR that materially changes the corpus shape.*

| Tier | Files | Test cases |
|---|---:|---:|
| **Unit** (Vitest `*.test.ts` / `*.test.tsx`) | 60 | 627 |
| ↳ apps/web | 31 | 280 |
| ↳ packages/shared | 19 | 246 |
| ↳ packages/baselines | 6 | 79 |
| ↳ apps/api | 4 | 22 |
| **Contract** (Vitest `*.contract.test.ts`) | 32 | 174 |
| ↳ apps/api | 24 | 139 |
| ↳ packages/shared | 8 | 35 |
| **Acceptance** (`.feature` files in `tests/features/**`) | 50 | 79 scenarios |
| ↳ identity | 23 | 34 |
| ↳ design-system | 11 | 23 |
| ↳ observability | 7 | 12 |
| ↳ org-admin | 8 | 9 |
| ↳ foundation | 1 | 1 |
| **Step library** (`apps/web/e2e/steps/**`) | 5 canonical + domain files | 145 Given/When/Then phrases |

**Pyramid shape today.** Broad unit base (627 cases) → narrower contract band (174 cases) → narrow acceptance top (79 scenarios). The shape matches the [§ Decision Matrix](#decision-matrix) — wire-shape and DB-state assertions are concentrated at the contract tier, user-visible outcomes are concentrated at the top, and pure logic / component-render assertions are pushed to the base.

**Per-workspace skew is intentional.** `apps/api`'s 22-case unit count is low because most of its logic is route handlers exercised at the contract tier (24 contract files, 139 cases). `apps/web`'s 280-case unit count is dominated by component-render coverage. `packages/shared`'s split (246 unit + 35 contract) reflects the boundary between pure helpers (RBAC policy, CSV parsing, validators) and persistence-touching code (Drizzle query helpers, cross-tenant isolation invariants).

**What's NOT in the count above.** Static-analysis gates (dependency-cruiser rules, Knip dead-code scan, lint baseline, RBAC matrix drift) are not "tests" in the pyramid sense — they're documented in [§ Static Analysis Gates](#static-analysis-gates) below.

---

## The Pyramid

```text
        ┌───────────────────────────────────┐
        │   BDD Acceptance                  │  ← Playwright + playwright-bdd
        │   User journeys, visual outcomes  │     tests/features/**/*.feature
        │   Authored in Gherkin             │     (Detox binder adds at v1.0)
        └───────────────────────────────────┘
        ┌───────────────────────────────────┐
        │   API Contract                    │  ← Vitest + ephemeral SQLite
        │   Wire shape, status codes,       │     apps/api/src/**/*.contract.test.ts
        │   DB side-effects, authz          │     helpers in packages/shared/src/testing/
        └───────────────────────────────────┘
        ┌───────────────────────────────────┐
        │   Unit                            │  ← Vitest, pure functions
        │   Logic, validation, RBAC,        │     colocated *.test.ts / *.test.tsx
        │   component rendering             │     or __tests__/
        └───────────────────────────────────┘
```

Every test belongs to **exactly one** tier. Tests that span tiers are a signal that the tier boundary is being violated — split them.

---

## Decision Matrix

Pick the tier by the **class of assertion** the test makes, not by the surface area of the code under test.

| Assertion class | Examples | Target tier | Tooling |
|---|---|---|---|
| Pure logic / validation | Zod schema rejects bad payload; slugify deterministic; `canPerform(role, resource, action)` returns `false` | Unit | Vitest, colocated `*.test.ts` |
| Component render / hook | `<Avatar>` falls back to initials; `useOnboardingGate` returns `pending` when timestamp is null | Unit | Vitest + React Testing Library, colocated `*.test.tsx` |
| API wire shape | `PATCH /api/v1/...` returns `200` with `{ success: true, data: {...} }` | Contract | Vitest + `createTestApp(db)` + `freshDb()`, `*.contract.test.ts` |
| HTTP status code (`401`, `403`, `404`, `429`) | Anonymous caller gets `401`; non-owner gets `403` | Contract | Vitest, `*.contract.test.ts` |
| DB side-effect | After `PATCH`, the row's column equals the new value; soft-deleted rows stay out of list | Contract | Vitest + ephemeral SQLite, `*.contract.test.ts` |
| Error envelope shape | Validation failure returns `{ success: false, error: { code, message } }` | Contract | Vitest, `*.contract.test.ts` |
| RBAC / authorization invariant | Every `(role, resource, action)` triple is exhaustively covered | Unit (policy) + Contract (enforcement) | Vitest; policy in `packages/shared/src/rbac/` |
| User-visible outcome | "After submitting the form, a success banner appears and the new row shows up in the list" | Acceptance | Playwright + playwright-bdd, `tests/features/**/*.feature` |
| Navigation / routing behavior | Signing in redirects to `/onboarding` when the gate is un-stamped | Acceptance | Playwright, `.feature` |
| Pagination envelope | Second page returns the next cursor | Contract | Vitest, `*.contract.test.ts` |
| Schema conformance (published API) | Response matches the published Zod schema | Contract | Vitest, `*.contract.test.ts` |
| Real-world timing | Token expires after `n` seconds | Unit (fake timers) | Vitest `vi.useFakeTimers()` |

**Rule of thumb.** If the assertion is about **shape or persisted state**, it's contract-tier. If it's about a **user's eyes on a screen**, it's acceptance-tier. Everything else is unit-tier.

---

## Assertion Placement Rule

**DB assertions and API-shape assertions MUST live at the contract tier.** They MUST NOT appear in `.feature` files, and SHOULD NOT appear in unit tests.

This is the pyramid's load-bearing constraint and the same rule restated at the framework level in [`.agents/rules/testing-standards.md` § Assertion Placement Rule](../.agents/rules/testing-standards.md#assertion-placement). Bidirectional companion: [`.agents/rules/gherkin-standards.md` § Forbidden Patterns](../.agents/rules/gherkin-standards.md#forbidden-patterns) enforces the same boundary from the acceptance side.

---

## Per-Tier Skeletons

The examples below are **skeletons**, not full implementations. They show the minimum structure each tier must follow.

### Unit — pure function

Location: colocate next to the source file.

```ts
// packages/shared/src/rbac/policy.test.ts
import { describe, expect, it } from 'vitest';
import { canPerform } from './policy';

describe('canPerform', () => {
  it('allows an org admin to manage their own org', () => {
    const allowed = canPerform('org_admin', 'organization', 'update', {
      actorOrgId: 'org-1',
      resourceOrgId: 'org-1',
    });
    expect(allowed).toBe(true);
  });

  it('denies an org admin managing a different org', () => {
    const allowed = canPerform('org_admin', 'organization', 'update', {
      actorOrgId: 'org-1',
      resourceOrgId: 'org-2',
    });
    expect(allowed).toBe(false);
  });
});
```

What belongs here: return values, thrown errors, exhaustive role/resource/action coverage. **Never** an HTTP status code, **never** a DB row assertion.

### Unit — React component

Location: colocate next to the component.

```tsx
// apps/web/src/components/ui/Avatar.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Avatar } from './Avatar';

describe('<Avatar>', () => {
  it('renders the image when src is provided', () => {
    render(<Avatar src="/img/a.png" name="Ada Lovelace" />);
    expect(screen.getByRole('img', { name: /ada lovelace/i })).toBeInTheDocument();
  });

  it('falls back to uppercase initials when src is missing', () => {
    render(<Avatar name="Ada Lovelace" />);
    expect(screen.getByText('AL')).toBeInTheDocument();
  });
});
```

Mock every external dependency (Clerk, Stripe, fetch). Component tests never touch the network.

### Contract — route round-trip

Location: `apps/api/src/**/*.contract.test.ts` (colocated, or under `__tests__/`).

```ts
// apps/api/src/routes/v1/<resource>/__tests__/patch.contract.test.ts
import { eq } from 'drizzle-orm';
import { resources } from '@repo/shared/db/schema';
import {
  createTestApp,
  freshDb,
  seedResource,
  seedUser,
  authHeaders,
} from '@repo/shared/testing';
import { describe, expect, it } from 'vitest';

describe('PATCH /api/v1/<resource>/:id', () => {
  it('updates the resource when the owner makes the request', async () => {
    // Arrange
    const db = await freshDb();
    const owner = await seedUser(db, { role: 'org_admin' });
    const resource = await seedResource(db, { ownerId: owner.id });
    const app = createTestApp(db);

    // Act
    const res = await app.request(`/api/v1/<resource>/${resource.id}`, {
      method: 'PATCH',
      headers: authHeaders(owner),
      body: JSON.stringify({ name: 'New name' }),
    });

    // Assert — wire shape
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, data: { name: 'New name' } });

    // Assert — DB side-effect
    const reloaded = await db.query.resources.findFirst({ where: eq(resources.id, resource.id) });
    expect(reloaded?.name).toBe('New name');
  });

  it('returns 403 with FORBIDDEN when a different user tries to update', async () => {
    const db = await freshDb();
    const owner = await seedUser(db, { role: 'org_admin' });
    const other = await seedUser(db, { role: 'org_admin' });
    const resource = await seedResource(db, { ownerId: owner.id });
    const app = createTestApp(db);

    const res = await app.request(`/api/v1/<resource>/${resource.id}`, {
      method: 'PATCH',
      headers: authHeaders(other),
      body: JSON.stringify({ name: 'Nope' }),
    });

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      success: false,
      error: { code: 'FORBIDDEN' },
    });
  });
});
```

- `freshDb()` returns a fresh ephemeral SQLite. Do **not** mock the DB layer at this tier.
- Contract tests run under `pnpm run test` — no separate Turbo pipeline.
- Every happy path needs at least one negative-path partner (validation error, authz failure, 404).

#### Authenticated routes — `createTestApp(db, { actor })`

Contract tests for protected routes use the two-argument form of
`createTestApp` to skip the JWT-validation stage while leaving every
other middleware in the chain — including `requireInternalUser`'s JIT
lookup — running real production code. The optional `actor` is an
`AuthContext` (`{ userId, clerkSubjectId, email, role, orgId, teamId }`)
that the test-auth seam writes into `c.var.auth` (and
`c.var.clerkSubjectId`) on every request.

```ts
import { type AuthContext, createTestApp, freshDb } from '@repo/shared/testing';

const db = await freshDb();
const actor: AuthContext = {
  userId: 'u_coach_1',
  clerkSubjectId: 'user_test_coach',
  email: 'coach@test.invalid',
  role: 'team_admin',
  orgId: 'org_test_a',
  teamId: 'team_test_a_1',
};
const app = createTestApp(db, { actor });
// app.request(...) sees c.var.auth === actor on every call.
```

Use the legacy single-argument form (`createTestApp(db)`) for anonymous
or 401-path tests. The `{ actor }` option swaps **only** the
JWT-validation stage; `requireInternalUser` and every route handler
downstream run unchanged from production. See
[`apps/api/src/routes/v1/me.actor.contract.test.ts`](../apps/api/src/routes/v1/me.actor.contract.test.ts)
for the load-bearing reference test that pins this contract across the
four MVP personas.

### Acceptance — user journey (Gherkin)

Location: `tests/features/**/*.feature` at the repo root. Step definitions live under `apps/web/e2e/steps/**` (and `apps/mobile/e2e/steps/**` once the mobile runner wires in at v1.0).

**Platform tagging convention.** No `@platform-*` tag means the scenario is cross-platform. `@platform-web` is reserved for scenarios whose underlying AC is genuinely web-only; `@platform-mobile` is the mirror. Authoring a scenario against the web runner first does **not** make it web-only — apply a `@platform-*` tag only when removing it would land a fictional AC on the other platform.

**Smoke vs. full corpus.** The `@smoke` tag identifies scenarios that run on **every PR** via the `acceptance-smoke` job in [`quality.yml`](../.github/workflows/quality.yml). The full acceptance corpus runs **nightly** via [`nightly.yml`](../.github/workflows/nightly.yml) — so a non-smoke scenario landing on a PR is "covered" by the next night's run, not by the PR's own gate. Reserve `@smoke` for scenarios that genuinely guard the wedge (the foundation smoke, the sign-in happy path); over-tagging defeats the purpose by blowing out PR runtime.

```gherkin
# tests/features/coach/roster/invite-athlete.feature
@identity::coach @domain::roster
Feature: Coach invites an athlete to a team

  Scenario: The athlete appears on the roster once they accept
    Given I am signed in as a head coach with a team
    When I invite an athlete by email and they accept the invitation
    Then I see the athlete listed on my team roster
```

The scenario asserts what the **user sees**. It does not mention HTTP status, table names, JSON payloads, DOM selectors, or URLs. The matching contract test covers the wire shape and row state.

Gherkin authoring rules live in [`.agents/rules/gherkin-standards.md`](../.agents/rules/gherkin-standards.md).

---

## Forbidden Patterns

Violations are review blockers. They are the mirror of the assertion-placement rule — shape and state belong in contract tests; business outcomes belong in acceptance scenarios.

### In unit tests

- ❌ **HTTP calls.** Unit tests never hit a real server or `fetch`. Mock at the boundary.
- ❌ **Status-code assertions.** `200`, `401`, `403`, `404`, `429` — all contract-tier.
- ❌ **DB row assertions.** Checking `SELECT` / `findFirst` / `db.query` results is contract-tier.
- ❌ **RBAC assertions that duplicate the policy module.** If `policy.test.ts` already covers a `(role, resource, action)` triple, do not re-assert it in a route or component test.
- ❌ **`any` or `@ts-ignore`.** Define the type. If the public API is too loose, fix the public API.

### In contract tests

- ❌ **Mocking the DB or the handler under test.** That defeats the purpose of the tier. External third parties (Clerk, Stripe, Mux) may be mocked; the persistence layer being exercised may not.
- ❌ **Driving the UI.** No React rendering, no Playwright, no DOM queries. If you need UI, move to acceptance.
- ❌ **Relying on real-world time.** Use `vi.useFakeTimers()` or seed deterministic clocks.

### In `.feature` files (acceptance)

- ❌ Raw SQL, table names, column names.
- ❌ HTTP verbs, status codes, URL paths, query parameters.
- ❌ JSON payloads, field names, response shapes.
- ❌ DOM selectors, `data-testid` values, CSS classes.
- ❌ API response-shape assertions (e.g. *Then the response body has 3 plans*). Push down to contract.

### Across all tiers

- ❌ **No test file uses `.spec.` suffix** for Vitest suites. Reserve `.spec.ts` for Playwright specs only.
- ❌ **No commented-out tests.** Delete them or fix them.
- ❌ **No real network calls.** Every outbound HTTP call in CI must be mocked at the boundary (unit/contract) or replayed against the preview stack (acceptance). Tests must be offline-safe.
- ❌ **No PII in fixtures.** Use synthetic values (`test-*@example.invalid`) — enforced at the Zod boundary of the fixture API.

---

## Where each tier lives (target)

| Tier | Location | Runner | Invocation |
|---|---|---|---|
| Unit | Colocated `*.test.ts` / `*.test.tsx`, or `__tests__/` inside the module | Vitest | `pnpm run test` |
| Contract | `apps/api/src/**/*.contract.test.ts`; helpers in `packages/shared/src/testing/` | Vitest + SQLite | `pnpm run test` |
| Acceptance (web, MVP) | `tests/features/**/*.feature` + `apps/web/e2e/steps/**` | Playwright-bdd | `pnpm --filter @repo/web exec bddgen` then `pnpm --filter @repo/web test:e2e` |
| Acceptance (mobile, v1.0) | `tests/features/**/*.feature` + `apps/mobile/e2e/steps/**` | Detox + Jest binder | wires in with the v1.0 native-apps Epic |

Unit and contract suites must be safe to run in parallel.

---

## Cross-platform execution *(v1.0)*

> **Forward-looking target.** The Detox binder, the parity checker, and the mobile step library are deferred to the v1.0 native-apps Epic. The text below is the written contract that Epic will deliver against — the web runner is the only live binding today.

The acceptance tier is **cross-platform first** by design: a scenario in `tests/features/**` is the single source of truth for a user-visible journey and is bound by both runners against their own step library — web via Playwright-bdd (live today), mobile via the Detox + Jest binder (v1.0). One scenario, two bindings, two runtime executions.

At MVP only the web runner exists. The step-definition linter (`scripts/lint-steps.mjs`, wired into `pnpm run lint:steps` and the Husky `pre-commit` hook) already enforces forbidden patterns and duplicate phrases against the web step library; the rest of the cross-platform machinery lands with the mobile-native Epic.

The v1.0 deliverables this section names as the written contract:

- **Detox + Jest binder.** Mobile step library lives at `apps/mobile/e2e/steps/`, mirroring the five canonical files under `apps/web/e2e/steps/` (`auth.steps.ts`, `form.steps.ts`, `navigation.steps.ts`, `rbac.steps.ts`, `visibility.steps.ts`). The same `.feature` scenarios run against both bindings.
- **Cross-runner parity checker.** `scripts/check-step-parity.mjs` compares the web and mobile step libraries phrase-for-phrase. Gaps are warnings during normal development and errors at Epic close — a phrase that exists in one binding but not the other blocks the v1.0 Epic from merging.
- **Step-definition linter** already runs the three rule classes against the web corpus (no duplicate phrases, no forbidden patterns — raw SQL, `/api/` URL literals, HTTP status-code assertions inside step bodies — and, at Epic close, no unused phrases). The v1.0 Epic extends its glob to cover `apps/mobile/e2e/steps/` as well.
- **Step catalog.** `scripts/step-catalog.mjs` emits the live phrase vocabulary and is consumed by agent workflows so scenario authoring stays grounded in the current step library across both bindings.

---

## Quality Baselines & Ratchets

The pyramid runs through a set of **baseline ratchets** — committed JSON snapshots under `baselines/` that record the current quality posture (coverage percentages, complexity scores, mutation kill rates, bundle sizes). Every PR re-runs the measurement and compares against the committed baseline; a regression beyond the per-baseline tolerance blocks merge. Improvements update the baseline in the same PR via `pnpm run <baseline>:update`.

The pattern is **ratchet-only**: baselines can tighten (improve) but never loosen automatically. A deliberate loosening requires explicit operator approval in the PR description and ideally an ADR amendment. The runbook for each ratchet lives in this document; the architectural rationale lives in the linked ADR.

### Coverage baseline (ADR-015)

- **What it measures.** Per-workspace line and branch coverage from Vitest's V8 coverage reporter, rolled up per workspace.
- **Baseline file.** [`baselines/coverage.json`](../baselines/coverage.json)
- **Producer script.** [`scripts/coverage-baseline.mjs`](../scripts/coverage-baseline.mjs)
- **Tolerance.** 2 percentage points below the recorded baseline per workspace. Smaller drops are absorbed silently to ride out platform/rounding noise; larger drops fail CI.
- **Where it runs.** `pnpm run coverage:check` locally and in the `Quality baselines` job of [`quality.yml`](../.github/workflows/quality.yml).
- **Special floors.** The RBAC policy module (`packages/shared/src/rbac/`) carries a ≥95% branch-coverage floor that does NOT decay with the ratchet — it's a hard threshold per ADR-015.
- **Update.** Run `pnpm run coverage:update` after a deliberate scope change, commit the regenerated file, name the run in the commit message.

### CRAP baseline (ADR-018)

- **What it measures.** Per-function **CRAP score** (Change Risk Anti-Patterns: complexity² × (1 − coverage)³ + complexity). High CRAP means high cyclomatic complexity with low coverage — the riskiest code in the repo.
- **Baseline file.** [`baselines/crap.json`](../baselines/crap.json)
- **Producer script.** [`scripts/crap-baseline.mjs`](../scripts/crap-baseline.mjs)
- **Tolerance.** Per-function relative-percent (5%) with a small absolute floor. New functions land in the baseline as-is (they're not "regressions" if there's no prior reading); existing functions cannot regress past the tolerance.
- **Where it runs.** `pnpm run crap:check` locally and in the `Quality baselines` CI job.
- **Update.** `pnpm run crap:update`. The common honest case is "I added a new function" — the update absorbs the new row; CI then enforces it going forward. The wrong move is to lower a hot function's bar to paper over uncovered complexity — diagnose the diff and either add tests or reduce branches.

### Maintainability baseline (ADR-019)

- **What it measures.** File-level **maintainability index** (a composite of Halstead volume, cyclomatic complexity, and SLOC, scaled 0–100). Higher is better.
- **Baseline file.** [`baselines/maintainability.json`](../baselines/maintainability.json)
- **Producer script.** [`scripts/maintainability-baseline.mjs`](../scripts/maintainability-baseline.mjs)
- **Tolerance.** A rolling minimum across the workspace plus a hard floor (currently 70). A single file dipping below the rolling minimum is logged; dropping the rolling minimum below the hard floor fails CI.
- **Where it runs.** `pnpm run maintainability:check` locally and in the `Quality baselines` CI job.
- **Update.** `pnpm run maintainability:update`. Same discipline as CRAP: absorb new files, refuse to absorb a regression on an existing file without a real reason.

### Mutation testing (Stryker)

- **What it measures.** Per-mutant kill rate from Stryker's vitest-runner. A mutant is a small syntactic change to production code (`+` → `-`, `>` → `>=`, drop a branch); a "killed" mutant means at least one test caught it, "survived" means the mutation went undetected. Surviving mutants are gaps your tests don't actually defend against.
- **Config.** [`stryker.config.json`](../stryker.config.json)
- **Baseline file.** [`baselines/mutation.json`](../baselines/mutation.json) — per-workspace mutation score with a 5% relative tolerance.
- **Producer script.** [`scripts/mutation-baseline.mjs`](../scripts/mutation-baseline.mjs)
- **Where it runs.** **Nightly only** via [`nightly.yml`](../.github/workflows/nightly.yml) — the run is too slow for PR CI (per PRD #195 non-goal). PR authors do not see mutation feedback at PR-open time; regressions surface in the morning report and are fixed as follow-ups.
- **Tier scope.** Unit tier only. Mutation testing is not meaningful at contract (mutants in integration paths frequently produce equivalent or unkillable cases) or acceptance (too slow, too coarse).
- **Update.** `pnpm run mutation:update` — typically run when a deliberate test-removal lowers the score, or when a new module crosses into the corpus. As with CRAP, lowering a kill rate to paper over a real gap is the wrong move.

### Bundle-size baseline

- **What it measures.** Per-workspace built-artifact size (`apps/web` Astro build, `apps/api` Worker bundle when Epic #27 wires it).
- **Baseline file.** [`baselines/bundle-size.json`](../baselines/bundle-size.json)
- **Producer script.** [`scripts/bundle-size-baseline.mjs`](../scripts/bundle-size-baseline.mjs)
- **Where it runs.** `pnpm run bundle-size:check` locally and in CI. See [`docs/patterns.md` § Bundle-size baseline ratchet](patterns.md#bundle-size-baseline-ratchet) for the per-workspace tolerance and the LCP-budget rationale.
- **Tier scope.** Sits alongside the pyramid, not inside it — bundle size is a performance gate, not a correctness assertion, but a regression here often surfaces a pyramid gap (e.g. a new dep imported without a corresponding test reduction).

### Lighthouse baseline

- **What it measures.** Web-app performance / accessibility / best-practices / SEO scores from a Lighthouse run against built `apps/web`.
- **Producer script.** [`scripts/lighthouse-baseline.mjs`](../scripts/lighthouse-baseline.mjs)
- **Baseline file.** *Not yet committed.* The script exists but the baseline file (`baselines/lighthouse.json`) has not been seeded yet — a future Story will land the first Lighthouse run against the production-shaped Astro build, commit the baseline, and wire the check into nightly CI.
- **Where it will run.** Nightly only, like mutation. Lighthouse is too slow and too environment-sensitive for PR gates.
- **Tier scope.** Same framing as bundle-size — sits alongside the pyramid as a performance gate, not a correctness gate.

### Lint baseline ratchet

- **What it measures.** Count of ESLint warnings/errors in the workspace, broken down per-rule. The ratchet only allows the count to go **down**, never up.
- **Baseline file.** [`baselines/lint.json`](../baselines/lint.json) (currently clean — 0 errors, 0 warnings, empty rows).
- **Producer script.** [`scripts/lint-baseline.mjs`](../scripts/lint-baseline.mjs)
- **Where it runs.** `pnpm run lint:baseline:check` locally, in the Husky `pre-commit` hook (via `quality-preview.js --staged`), and in CI's `Quality baselines` job.
- **Tier scope.** A correctness gate at the linter layer. See [`docs/patterns.md` § Lint baseline ratchet](patterns.md#lint-baseline-ratchet) for the per-rule update procedure.

---

## Static Analysis Gates

These gates do not belong to a pyramid tier — they enforce structural and policy invariants that complement the tests. Most run on every PR; some run only in the Husky `pre-commit` chain.

### Dependency-cruiser (architecture rules)

- **Config.** [`.dependency-cruiser.cjs`](../.dependency-cruiser.cjs)
- **What it enforces.** The cross-workspace import graph. Today's rules include `no-circular`, `no-orphans`, `not-to-unresolvable`, `no-deprecated-core`, `not-to-dev-dep`, `shared-must-not-depend-on-apps` (the load-bearing rule that keeps the package hierarchy honest), `apps-must-not-cross-import`, `api-must-not-import-web`, `mobile-must-not-cross-import`, `no-relative-apps-to-packages`, `test-helpers-only-in-tests`, `drizzle-schema-owns-tables`, and `auth-middleware-no-incoming-routes`.
- **Where it runs.** `pnpm run lint:deps` locally; CI gates every PR on it.
- **Tier scope.** Not a "test" in the pyramid sense — these are **architecture rules**. Violations are review blockers, not absorbed via a baseline. See [`docs/patterns.md` § Dependency boundaries (dependency-cruiser)](patterns.md) for the per-rule rationale.

### Knip — dead code

- **Config.** [`knip.config.ts`](../knip.config.ts)
- **What it enforces.** Unused exports, unused dependencies, unused files. Complements `dependency-cruiser` (which enforces import-graph shape) by catching the broader dead-export sweep.
- **Where it runs.** `pnpm run knip:strict` in CI (fails on any unused export); `pnpm run knip:fast` for a lighter local pass focused on files + dependencies only.
- **Tier scope.** Static analysis. Dead-code regressions sometimes signal an abandoned test path — the linter catches them before they rot.

### Secretlint

- **Config.** [`.secretlintrc.json`](../.secretlintrc.json) + the `@secretlint/secretlint-rule-preset-recommend` preset.
- **What it enforces.** No real secrets in tracked files — API keys, JWT tokens, AWS credentials, GitHub PATs, etc. The preset's ignore list lives in `.secretlintignore` for known-safe matches.
- **Where it runs.** `pnpm run lint:secrets` locally and in CI; the Husky `pre-commit` hook runs it against staged changes.
- **Tier scope.** Security gate. Cross-references [`.agents/rules/security-baseline.md` § Secrets Management](../.agents/rules/security-baseline.md).

### Step-definition linter

- **Producer script.** [`scripts/lint-steps.mjs`](../scripts/lint-steps.mjs)
- **What it enforces.** Three rule classes against `apps/web/e2e/steps/**`:
  1. **No duplicate phrases.** A `Given/When/Then` phrase MUST be defined exactly once across the step library.
  2. **No forbidden patterns inside step bodies.** Raw SQL, `/api/` URL literals, HTTP status-code assertions (`expect(res.status).toBe(...)`) — all push down to contract tests per [§ Assertion Placement Rule](#assertion-placement-rule).
  3. **No unused phrases at Epic close.** Warnings during normal development; build failures at Epic close.
- **Where it runs.** `pnpm run lint:steps` locally, in the Husky `pre-commit` hook, and in the `lint-steps` job of [`quality.yml`](../.github/workflows/quality.yml).
- **Companion.** [`scripts/step-catalog.mjs`](../scripts/step-catalog.mjs) emits the live phrase vocabulary used by agent workflows for grounded scenario authoring.

### RBAC matrix drift check

- **Producer script.** [`scripts/render-rbac-matrix.mjs --check`](../scripts/render-rbac-matrix.mjs)
- **What it enforces.** The published RBAC matrix in [`docs/data-dictionary.md`](data-dictionary.md) matches the source-of-truth `(role, resource, action)` triples in `packages/shared/src/rbac/`. A change to the policy module that isn't reflected in the docs fails CI.
- **Where it runs.** The Husky `pre-commit` hook (so the doc is regenerated alongside the code change) and the `quality.yml` CI gate.
- **Tier scope.** Doc-as-test. Pairs with the unit-tier policy tests under `packages/shared/src/rbac/`.

---

## Manual Testing

> Human-driven testing is the counterpart to the automated pyramid above. Automation covers regression — that a known behavior still works. Manual testing covers the things humans notice that machines don't: visual polish, copy tone, real-device feel, the "does this flow actually feel right" question, and the edge cases nobody thought to encode in a `.feature` file yet.
>
> This section defines **when** to test manually, **what** to test, and **where** the artifacts live. The cadence is referenced from [`docs/path-to-mvp.md`](path-to-mvp.md) as the manual-QA gate between phases, and is the ongoing rhythm after MVP.
>
> The **scripted artifacts** that drive manual sessions (Test Plans, Exploratory Charters, the shared heuristic library) live in the [§ QA Corpus](#qa-corpus) section below. The Manual Testing section here governs the **cadence and judgment calls**; the QA Corpus section governs the **on-disk shape, the lint gates, and the agent-runner contract** that lets a human session and an agent-driven session ride the same artifacts.

### What manual testing is for

Use manual testing for:

- **Visual polish** — alignment, spacing, typography, hover states, focus rings, dark-mode contrast.
- **Copy quality** — tone, voice, error-message helpfulness, microcopy that machines can't grade.
- **Real-device feel** — touch targets on a phone, scroll inertia, keyboard handling, screen-reader announcements.
- **Cross-surface flows** — a journey that crosses email → web → mobile, where any single tier's automation can't see all three.
- **Exploratory edge cases** — "what happens if I…?" probes that surface bugs no scenario author predicted.
- **Production-only validations** — DNS, deliverability, third-party webhooks, real Stripe payments, real Mux pipelines.

Do **not** use manual testing for:

- Anything an automated test already covers reliably. If a manual check keeps catching regressions, write the test.
- Mass-scale data validation — that's a contract-tier test against a real DB.
- "I'll just click around for a few minutes" with no charter. Untracked manual testing finds nothing reproducible.

### The three cadences

#### 1. Per-Story exploratory charter

Every Story whose acceptance criteria include a user-visible surface gets a **10-minute exploratory charter** before the Story closes. The charter is appended to the Story's GitHub issue as a structured comment.

##### Charter template

```markdown
### Manual exploratory charter — Story #<id>

- **Mission:** <one sentence — what am I trying to learn?>
- **Surfaces:** <which pages, components, or flows>
- **Personas:** <which seeded test users>
- **Devices:** <desktop browser + at least one mobile viewport unless the surface is desktop-only>
- **Timebox:** 10 minutes
- **Findings:**
  - <bug | polish | copy | a11y | perf — one line each, link issues if filed>
- **New automated tests filed:** <list issue numbers, or "none">
```

Rules:

- The mission must be falsifiable — "explore the form" is not a mission; "find ways a coach could submit the form and end up with a confusing error" is.
- Every finding either gets filed as an issue or recorded as deliberately accepted. No "I'll remember it" findings.
- If a finding could have been caught by an automated test, file the test-writing work as part of closing the Story.

#### 2. Per-phase regression checklist

The checklist below grows phase-by-phase as new surfaces land. It is the **accumulating** manual sweep run before each phase's exit gate. New rows are appended at the end of the phase that introduced the surface; rows are never deleted, only marked deprecated when a surface is removed.

The checklist lives in this section (see [§ Regression checklist](#regression-checklist)) so it sits next to the strategy that governs it. When a row's manual check becomes reliably automated, the row is marked **(automated → see <test path>)** and skipped during the sweep — but kept in the list for traceability.

#### 3. Pre-release sweep

Before MVP launch (Phase 7) and before every subsequent production release, run the **full** accumulated regression checklist against the staging environment with production-shaped data. Findings block the release until either fixed or explicitly accepted by the operator with a documented risk note.

Pre-release sweep specifics:

- Run from a **fresh** browser profile (no cached auth, no stale service worker).
- Run against **at least** one mobile device per platform (iOS Safari, Android Chrome) — not just emulators.
- Capture screenshots or screen recordings of the entire happy path; archive them with the release tag.
- The sweep is performed by **two people** when possible — the second pair of eyes catches the first's blind spots.

### Phase gates

Each phase in [`docs/path-to-mvp.md`](path-to-mvp.md) has a **Manual QA gate** as part of its exit criteria. The gate is satisfied when:

1. Every Story in the phase has a charter appended to its issue.
2. The phase's incremental section of the regression checklist (the rows added during this phase) passes end-to-end against staging.
3. Any open findings are either fixed or have a documented operator decision to defer.

Specific charters called out by phase below are the minimum — Stories may add more.

| Phase | Required charters |
| --- | --- |
| 1 — Tenancy & onboarding | Tenancy isolation; signup → org creation → invitation |
| 2 — Identity surface | Profile completion happy path; calendar event publish + RSVP; public-profile SEO render |
| 3 — Verified stats & media | Coach signs a stat → athlete sees badge; media upload survives full safety pipeline |
| 4 — Communication | Push + email round-trip; preference center mutes both; team-feed cross-tenant isolation |
| 5 — Safety & compliance | Parental consent grant/revoke visible on minor's surfaces; DSAR end-to-end; coach without SafeSport blocked from minor team |
| 6 — Public surface & growth | Anonymous funnel from landing → club page → signup; crawler `robots.txt` honored |
| 7 — Launch | Full pre-release sweep against production environment |

### Devices, browsers, and personas

#### Browser matrix

The matrix is intentionally narrow at MVP. Add a row only when a real user reports a problem on a browser that isn't listed.

| Surface | Required browsers |
| --- | --- |
| Public anonymous (landing, public profile, directories) | Latest Chrome, latest Safari, latest Firefox, iOS Safari, Android Chrome |
| Authenticated coach / org admin surfaces | Latest Chrome, latest Safari |
| Authenticated athlete surfaces | Latest Chrome, latest Safari, iOS Safari, Android Chrome |
| Admin dashboard | Latest Chrome |

#### Device matrix

| Class | Minimum device for pre-release sweep |
| --- | --- |
| iOS phone | One real iPhone running the latest public iOS, plus one on the previous major version |
| Android phone | One real Android running the latest Chrome |
| Tablet | iPad (Safari) — public surfaces only |
| Desktop | Whatever the operator uses; Lighthouse runs are captured here |

Emulators and responsive-mode browser viewports are acceptable for per-Story charters. They are **not** sufficient for the pre-release sweep.

#### Personas

Use the seeded test-instance personas from [§ Canonical step vocabulary](#canonical-step-vocabulary):

- `athlete` — minor and adult variants.
- `coach` — head coach with a team; assistant coach.
- `org admin` — owns an org with multiple teams.
- `dev admin` — platform admin.
- `parent` — once Phase 5 lands.
- `anonymous` — no session.

Test data must be **synthetic** — synthetic emails (`*@example.invalid`), synthetic names, no real PII even in staging.

### Accessibility, performance, and security touchpoints

These overlap with automated checks but always benefit from a human pass:

- **Accessibility.** Tab through the surface with a keyboard. Run a screen reader on the happy path at least once per phase. Check focus rings, skip links, and form-error announcements. Axe / Lighthouse a11y scores are floors, not ceilings.
- **Performance.** Lighthouse on the public surfaces at the end of every phase that touches them. Real-device "feel" check on a mid-tier Android — emulators lie about scroll smoothness.
- **Security spot-checks.** Try the obvious things: change an ID in a URL, submit a form as a different role via the network tab, paste a JWT from another tenant. Findings file as security issues, not feature bugs.

### Findings, triage, and closing the loop

- File every finding as a GitHub issue. Tag with `manual-qa`. Link back to the Story or phase that surfaced it.
- Findings that recur across phases are a signal the automated tier is wrong, not that the manual sweep is working. Open a meta-issue to add the missing automated coverage.
- A finding is **closed** only when the fix has landed *and* either (a) an automated test now covers it, or (b) the operator has explicitly accepted that this class of bug stays in the manual-only column with a documented reason.

### Regression checklist

The accumulating sweep, grouped by phase. Rows are appended as phases land. The "Run" column is checked off during each pre-release sweep — never edited in-place; copy the table into the release notes and check it there.

> **Status today:** Foundation phases (0) are complete but no user-visible surface has shipped yet, so the checklist below is the **target shape**. Rows are filled in as each phase's Stories close.

#### Phase 1 — Tenancy & onboarding

- [ ] Signup with new email → email verification → onboarding gate → ToS acceptance → org creation.
- [ ] Org admin creates a team and invites a coach by email.
- [ ] Coach accepts invitation and appears on team's coaching staff.
- [ ] Coach invites an athlete; athlete accepts; athlete appears on roster.
- [ ] Cross-tenant probe: a user in Org A cannot see Org B's roster, teams, or org settings via the UI or by manipulating IDs.
- [ ] ToS version bump forces re-acceptance on next sign-in.

#### Phase 2 — Identity surface

- [ ] Athlete completes profile to 100%; completion badge updates live.
- [ ] Athlete sets vanity URL; collision against an existing URL is rejected with a helpful message.
- [ ] Public profile renders correctly when shared as a link (OpenGraph card, title, description).
- [ ] Coach publishes a calendar event; athletes on the team see it.
- [ ] Athlete RSVPs; the coach's event view reflects the RSVP within the expected propagation time.
- [ ] iCal feed URL produces a valid `.ics` file that imports cleanly into Google Calendar and Apple Calendar.

#### Phase 3 — Verified stats & media

- [ ] Coach records a stat from the sideline UI on a mobile device with patchy connectivity; stat is queued and syncs when online.
- [ ] Coach signs the stat; athlete's public profile reflects the verified badge.
- [ ] Stat-signature audit trail visible in admin dashboard with timestamp and signer identity.
- [ ] Media upload (photo + video) survives the safety pipeline end-to-end; unsafe content is blocked with a clear user message.
- [ ] Block / report flow: athlete reports a coach; report appears in admin queue.

#### Phase 4 — Communication & engagement

- [ ] Event publication triggers push (on PWA-installed device) and email.
- [ ] Preference center mutes push only; email still delivers. Then mutes email only; push still delivers.
- [ ] Team-feed post is visible to roster members; never to a user in another team or org.
- [ ] PWA installs from the browser prompt; survives a service-worker update without losing auth.

#### Phase 5 — Safety, compliance, legal

- [ ] Parent claims their minor athlete; consent state visible on the minor's surfaces.
- [ ] Parent revokes consent; previously consented surfaces immediately lock down.
- [ ] DSAR submission produces a downloadable export within the documented SLA.
- [ ] Account deletion request flows through admin dashboard; user disappears from public surfaces; retention policy honored on the back end.
- [ ] Coach without completed SafeSport cannot be added to a team containing a minor.
- [ ] Admin impersonation: every impersonated action is logged with both the operator and the impersonated user.

#### Phase 6 — Public surface & growth

- [ ] Anonymous landing → club page → public roster → public profile → signup CTA, all reachable without auth.
- [ ] `robots.txt` and sitemap reflect the documented crawler policy; private surfaces are excluded.
- [ ] Funnel instrumentation fires the expected events on anonymous → registered conversion.
- [ ] Apex domain redirects to canonical hostname; HTTPS enforced; HSTS header present.

#### Phase 7 — Launch

- [ ] Full sweep of phases 1–6 against the production environment with seeded beta data.
- [ ] Real Stripe payment in live mode (if commerce ships at MVP).
- [ ] Production email deliverability: signup confirmation lands in Gmail, Outlook, iCloud inboxes (not spam).
- [ ] On-call rotation paged by a deliberate synthetic alert; runbook executed end-to-end.
- [ ] Rollback rehearsed: a tagged release can be reverted without data loss within the documented RTO.

### How to update this section

- A new surface lands → append rows to the relevant phase's regression checklist in the same PR that ships the surface.
- A manual check becomes reliably automated → mark the row **(automated → see <test path>)** rather than deleting it.
- A finding recurs across phases → that's a signal; open a meta-issue to add automated coverage rather than just adding another checklist row.
- A surface is removed → mark its rows **(deprecated — <date>)** rather than deleting them, so the change is traceable in git history.

---

## QA Corpus

> The QA Corpus is the on-disk substrate that turns the [§ Manual Testing](#manual-testing) cadence into reviewable, lintable, and re-runnable artifacts. It complements the unit, contract, and acceptance tiers above — it does not replace them. Test Plans script the manual sweeps that the automated tiers can't yet reach; Exploratory Charters drive the time-boxed probes that surface the next round of bugs.
>
> **Citations.** [Tech Spec #782](https://github.com/dsj1984/athportal/issues/782) § Core Components #7–8, [PRD #781](https://github.com/dsj1984/athportal/issues/781) AC-9, [Acceptance Spec #783](https://github.com/dsj1984/athportal/issues/783) AC-16.

### Overview

The corpus is two artifact families and a shared library:

- **Test Plans** (`tests/plans/<domain>/tp-*.plan.md`) — scripted, repeatable walk-throughs of a user-visible journey. A plan declares its surface, persona, route prefixes, and time-box in YAML front-matter, then walks Setup → numbered Steps (each with an `**Expected:**` line) → Cleanup. Plans are the unit of *regression manual sweep*: every plan must be runnable by a human or by an agent runner against the same artifact and produce the same verdict.
- **Exploratory Charters** (`tests/charters/<domain>/ec-*.charter.md`) — time-boxed probes whose mission is to *find* something, not to confirm a known outcome. A charter declares a mission, a list of heuristics it will apply, and a load-bearing `safety_constraints` block (environment scope, mutation surface, required reset). Findings are appended to the charter's `## Findings` table; promotable findings become Test Plans or `.feature` scenarios in a follow-up PR (see [§ Promotion pipeline](#promotion-pipeline-charter-finding--test-plan--scenario) below).
- **Heuristic library** (`tests/charters/_heuristics/<name>.md`) — shared, named heuristic cards (boundary-values, encoding-fuzz, cross-tenant-probe, …) referenced by charters via the `heuristics:` array in front-matter. Reuse is enforced at the lint layer: a charter that lists an unknown heuristic name fails `pnpm run lint:qa` with a clear "does not resolve to tests/charters/_heuristics/<name>.md" error.

**Human-vs-agent parity** is the principle that holds the corpus together. Every artifact is authored once and read by both audiences:

- A **human** opens the file in their editor, follows the Setup, runs the Steps, and either records pass/fail (plan) or appends findings (charter).
- An **agent** loads the same file via the upcoming `/run-qa`-family slash commands (see [§ Agent-runner runbook](#agent-runner-runbook)) and drives the same workflow through the `chrome-devtools` MCP surface. The agent sees the same front-matter, the same numbered steps, the same `**Expected:**` predicates, and (for charters) the same `safety_constraints` gate.

The parity rule is enforced bidirectionally: an instruction that only a human can follow ("look closely at the spacing") belongs in the body as a `**Note:**` aside, not as a numbered step the agent will try to assert against. An instruction that only an agent can follow ("use the chrome-devtools `take_snapshot` tool") belongs nowhere — it leaks runtime implementation into a portable artifact. Both sides drive against user-visible outcomes only.

### Test Plan format

Test Plan front-matter is validated by [`scripts/qa/schema/plan.front-matter.zod.ts`](../scripts/qa/schema/plan.front-matter.zod.ts). The required fields are:

| Field | Type | Notes |
|---|---|---|
| `id` | string | Kebab-case, prefixed with `tp-`. Regex: `^tp-[a-z0-9]+(?:-[a-z0-9]+)*$`. Example: `tp-identity-signup-happy-path`. |
| `type` | literal `plan` | Used by the lint dispatcher to route the file to the plan branch. |
| `title` | string | One-line human-readable headline. |
| `domain` | enum | One of the values in [`scripts/qa/schema/domains.ts`](../scripts/qa/schema/domains.ts). Live domains today: `identity`, `org-admin`, `design-system`. Deferred entries (`marketing`, `public-discovery`, `settings`, `athlete-dashboard`, `coach-dashboard`) are accepted by the schema so future Epics land their plans in the same PR that ships the routes. `mobile` is reserved. |
| `persona` | enum | One of `visitor`, `athlete`, `coach`, `org-admin`, `platform-admin` (see [`scripts/qa/schema/personas.ts`](../scripts/qa/schema/personas.ts)). Mirrors [`docs/personas.md`](personas.md). |
| `surface` | enum | `web` today. `mobile` is reserved until the mobile Epic lands. |
| `route_prefixes` | string[] | At least one entry. Each must start with `/` and use URL-safe characters. |
| `est_minutes` | positive integer | The human time-box. The runner does not enforce this — it is documentation. |
| `prerequisites` | string[] | Optional. Free-form natural-language list of setup steps the agent or human must satisfy before starting. |

The body follows a canonical three-section shape. Each section is a top-level H2 in the exact order below:

1. `## Setup` — natural-language prose listing the preconditions (local stack running, DB seeded, test email picked, side-channels ready).
2. `## Steps` — a numbered list. Every step's body MUST contain a `**Expected:**` line. The lint script enforces this — a numbered step without an expected line fails `lint:qa` with `step <n> is missing an "**Expected:**" line`.
3. `## Cleanup` — natural-language prose listing the teardown actions (sign out, reset DB, delete partially-registered Clerk users).

Example skeleton:

````markdown
---
id: tp-identity-signup-happy-path
type: plan
title: Sign-up → onboarding happy path (athlete)
domain: identity
persona: athlete
surface: web
route_prefixes:
  - /sign-up
  - /onboarding
est_minutes: 8
prerequisites:
  - "local stack running (pnpm dev)"
  - "DB seeded with a fresh org via pnpm --filter @repo/shared run db:seed"
---

## Setup

- Confirm the local stack is running …
- Pick a fresh, unique test email address …

## Steps

1. Open a fresh browser session and visit `/sign-up`.
   **Expected:** the sign-up page renders with a heading that announces the sign-up flow …

2. Enter the test email address and a strong password, then submit the form.
   **Expected:** the page transitions to a "verify your email" state …

## Cleanup

- Sign out by visiting `/sign-out` …
- Reset the local DB: `pnpm --filter @repo/shared run db:reset && pnpm --filter @repo/shared run db:seed`.
````

The live pilot lives at [`tests/plans/identity/tp-identity-signup-happy-path.plan.md`](../tests/plans/identity/tp-identity-signup-happy-path.plan.md) — copy its shape verbatim when authoring a new plan.

### Exploratory Charter format

Exploratory Charter front-matter is validated by [`scripts/qa/schema/charter.front-matter.zod.ts`](../scripts/qa/schema/charter.front-matter.zod.ts). The required fields are:

| Field | Type | Notes |
|---|---|---|
| `id` | string | Kebab-case, prefixed with `ec-`. Regex: `^ec-[a-z0-9]+(?:-[a-z0-9]+)*$`. Example: `ec-org-admin-csv-import`. |
| `type` | literal `charter` | Lint dispatcher route. |
| `title` | string | One-line human-readable headline. |
| `domain` | enum | Same enum as plans (see above). |
| `persona` | enum | Same enum as plans (see above). |
| `route_prefixes` | string[] | At least one. Same regex as plans. |
| `mission` | string | One-sentence falsifiable mission (e.g. "find ways the CSV import surface accepts malformed data without surfacing a visible error"). |
| `heuristics` | string[] | At least one kebab-case heuristic name. Each must resolve to `tests/charters/_heuristics/<name>.md` — the lint script enforces this. |
| `time_box_minutes` | positive integer | The session timebox (typically 15–30 minutes). |
| `safety_constraints` | object | **Mandatory, load-bearing.** See [§ Safety-constraints contract](#safety-constraints-contract) below. |
| `prerequisites` | string[] | Optional, same shape as plans. |

The body shape:

1. `## Mission` — a paragraph expanding the front-matter mission with the *why* (which downstream surfaces a bug here would corrupt, what classes of defect are most dangerous).
2. `## Heuristics` — one bullet per heuristic listed in the front-matter, with a sentence or two explaining how this charter will apply that named heuristic to the specific surface.
3. `## Notes` — optional scratchpad. The session runner appends per-snapshot notes here.
4. `## Findings` — a table with columns `id | title | severity | repro | suggested-promotion`. New findings are appended as new rows; rows are never deleted — promoted findings stay in the table for traceability with their `suggested-promotion` cell pointing at the follow-up issue or PR.

The live pilot lives at [`tests/charters/org-admin/ec-org-admin-csv-import.charter.md`](../tests/charters/org-admin/ec-org-admin-csv-import.charter.md) — copy its shape when authoring a new charter.

### Heuristic library

Shared heuristic cards live under [`tests/charters/_heuristics/`](../tests/charters/_heuristics/). Each card is a single Markdown file whose basename (without `.md`) is the heuristic's canonical name. A charter references a heuristic by listing the basename in its `heuristics:` array; the lint script registers every file in the directory at startup and rejects any name that does not resolve.

The 8 heuristics shipped by Story #791:

| Name | What it probes |
|---|---|
| `boundary-values` | Off-by-one transitions on every numeric/length/range bound the surface accepts. |
| `auth-fuzz` | Authentication surface: malformed sessions, expired tokens, cross-tenant cookies, replay attempts. |
| `cross-tenant-probe` | Ownership invariants: can a user in Org A see, mutate, or enumerate resources in Org B by manipulating IDs? |
| `email-collision` | Email-uniqueness invariants: case-folding, plus-addressing, Unicode lookalikes, normalization corners. |
| `encoding-fuzz` | Character-encoding deviations from the parser's assumptions (UTF-16-LE, BOMs, Windows-1252 smart quotes, embedded NUL bytes). |
| `form-fuzz` | Wrong-type values substituted into typed fields (phone in email, HTML in name, oversize strings in capped columns). |
| `landmark-tour` | Accessibility landmark sweep: every page reachable via landmarks, every form labelled, every interactive control reachable by keyboard. |
| `money-tour` | Money handling: currency formatting, rounding boundaries, negative values, zero-amount handling, currency-mixing edge cases. |

Heuristic cards are intentionally short — a `## When to apply` paragraph and a list of concrete probes. They are reference material, not scripts; the charter that *uses* a heuristic is responsible for translating it into surface-specific moves.

### Lint, index, and coverage gates

The QA Corpus has three CLI gates, layered:

- **`pnpm run lint:qa`** — runs [`scripts/qa/lint.mjs`](../scripts/qa/lint.mjs). Discovers every `*.plan.md` under `tests/plans/` and every `*.charter.md` under `tests/charters/` (skipping `_heuristics/`), validates each artifact's front-matter against the matching Zod schema, validates the body-section shape, and (for charters) resolves every heuristic name against the `_heuristics/` directory. Exit code 0 on a clean pass, 1 on any artifact failure, 2 on CLI misuse. Wired into the `quality.yml` CI gate and (via a later Story) the Husky `pre-commit` hook against staged `.plan.md` / `.charter.md` paths.
- **`pnpm run index:qa`** *(lands with a later Story)* — emits a deterministic JSON index of the corpus (id, type, domain, persona, route_prefixes, file path) so agent workflows and the coverage check can read the corpus shape without re-parsing every file. The index is committed and ratcheted; drift between the index and the on-disk corpus fails CI.
- **`pnpm run coverage:qa`** *(lands with a later Story)* — enforces the per-domain plan + charter floors declared in `scripts/qa/schema/coverage-floors.ts` (planned location; ships with the coverage Story). A domain whose plan count falls below its floor fails CI, the same ratchet shape as the other quality baselines.

`lint:qa` is the only gate live today; `index:qa` and `coverage:qa` are forward-looking commitments named here so authors and reviewers know the lint they pass on PR-open is the first of three.

### Agent-runner runbook

The agent runners are slash commands that load a QA-corpus artifact, drive the steps through the `chrome-devtools` MCP surface, and record the outcome back to the artifact (charters) or to the run-log (plans). The commands land in later Stories of Epic #775:

- **`/run-qa <plan-or-charter-id>`** *(lands with Story #794)* — runs a single named artifact end-to-end. Loads the file from `tests/plans/` or `tests/charters/` by `id`, validates it through the same Zod schemas the linter uses, then dispatches to the plan-runner or charter-runner.
- **`/run-qa-domain <domain>`** *(lands with Story #807)* — runs every artifact in a domain (e.g. all `domain: identity` plans + charters) in deterministic id-sorted order.
- **`/run-qa-all`** *(lands with Story #807)* — runs the entire corpus. The pre-release sweep companion to the human pre-release sweep documented in [§ Pre-release sweep](#3-pre-release-sweep).

The runners drive the browser through the `chrome-devtools` MCP surface — `navigate_page`, `take_snapshot`, `click`, `fill`, `evaluate_script`, `take_screenshot`, `list_console_messages`, and `list_network_requests` are the primary tools. The runner reads `route_prefixes[0]` from front-matter to decide where to start, applies each step's interaction, then evaluates the `**Expected:**` predicate against the post-step snapshot.

**Safety gate.** A charter whose `safety_constraints.environment` is anything other than `local` cannot run unless the operator passes `--allow-non-local` explicitly. The gate exists because charters mutate state (per the `mutation_surface` declaration) and a stray `preview` or `staging` run would leak fuzz data into a shared environment. The `environment: prod` value is denylisted at the schema layer, so a prod-targeted charter cannot even land on `main` — the runner gate is a second line of defense against the `local` → non-local class of mistake.

### Promotion pipeline (charter finding → Test Plan / scenario)

A charter is a *probe*; once it finds a real defect, the defect is fixed and the surface gains a permanent guard. The fix PR carries the promotion:

- **Always:** the bug fix itself, plus a row appended to a Test Plan that exercises the regression manually. If the affected surface had no plan yet, the PR creates the plan. The charter's `## Findings` row's `suggested-promotion` cell points at the plan id (and, when relevant, the new contract or unit test).
- **When the defect is user-visible:** a new `.feature` scenario at the acceptance tier asserting the user-visible outcome ("after a malformed CSV upload, the operator sees a row-level error"). The scenario is authored per [`gherkin-standards.md`](../.agents/rules/gherkin-standards.md) and does NOT assert on the wire shape — that lives in the matching contract test under `apps/api/src/**/*.contract.test.ts`.

The pipeline closes the loop: a charter finding is never a one-shot — it is the trigger for both a regression script and (where the assertion class warrants it) a permanent automated guard. The charter row stays in `## Findings` with its `suggested-promotion` populated so a future reviewer can trace fix → plan → scenario → test.

### Safety-constraints contract

The `safety_constraints` block on every charter is the corpus's load-bearing security gate. It is validated by [`scripts/qa/schema/charter.front-matter.zod.ts`](../scripts/qa/schema/charter.front-matter.zod.ts) and has three required fields:

- **`environment`** — one of `local`, `preview`, `staging`. The literal `prod` is **denylisted at the schema layer**: the Zod error message reads "safety_constraints.environment must not be \"prod\" — charters that target production are denylisted at the lint layer" so the operator immediately understands a denylist, not a typo, is the cause. The `lint:qa` gate therefore refuses to merge a prod-targeted charter onto `main`. The agent-runner gate is the second line of defense — `environment: local` runs without ceremony; anything else requires the operator to pass `--allow-non-local` explicitly.
- **`mutation_surface`** — a non-empty list of natural-language identifiers naming every persisted surface the charter is allowed to mutate (e.g. `"csv_import_batches table"`, `"athlete_memberships table"`). The list is documentation for the operator and a checklist for the cleanup step — it does NOT grant runtime capability; the runner does not enforce a per-table allow-list. The list's load-bearing role is review: a charter that mutates a surface not declared here is a defect in the charter, caught at PR review.
- **`required_reset`** — a single string naming the command (or sequence) that returns the named mutation surface to a clean state. Example: `"pnpm --filter @repo/shared run db:reset && pnpm --filter @repo/shared run db:seed"`. The runner displays this string at the end of every charter session as a reminder; the human operator runs it before the next charter.

A charter that omits any of the three fields fails `lint:qa` with a path-prefixed error (e.g. `safety_constraints.environment: Required`) so the operator sees the missing field by name.

### Per-domain coverage floors

Each live domain carries a minimum plan + charter count, enforced by `pnpm run coverage:qa` (lands with a later Story; the floors table below is mirrored from `scripts/qa/schema/coverage-floors.ts`'s planned shape so reviewers do not need to open the Epic).

| Domain | Plans (floor) | Charters (floor) |
|---|---:|---:|
| `identity` | 10 | 1 |
| `org-admin` | 6 | 2 |
| `design-system` | 1 | 0 |

Domains not listed (`marketing`, `public-discovery`, `settings`, `athlete-dashboard`, `coach-dashboard`) are deferred — their floors land in the same PR that ships the routes those domains cover. `mobile` is reserved.

The floors ratchet only upward: a Story that lifts a domain's plan count over its floor lands the new floor in the same PR. Lowering a floor requires explicit operator approval in the PR description, the same discipline as the lint and coverage baselines above.

---

## Coverage expectations

- **Line / branch coverage** — measured at the unit tier only. The RBAC policy module carries a ≥95% branch-coverage floor; other packages follow each workspace's Vitest config default and ratchet via the [coverage baseline](#coverage-baseline-adr-015).
- **Contract coverage** — measured by API surface, not lines. Every public route, published event, and shared Zod schema SHOULD have at least one happy-path and one negative-path contract test.
- **Mutation testing** — runs on the unit tier nightly. Acceptance-tier mutation is in-scope but lower priority than unit (and lower threshold accordingly).

Coverage targets apply to production code. Test helpers, fixtures, and generated code are excluded.

---

## When to add a test vs. when to move one

- **Adding a new route** → add a contract test that covers the happy path and at least one failure mode; cover the underlying logic with unit tests.
- **Fixing a regression** → write the failing test **first** at the tier that matches the class of assertion, then fix the code.
- **A test is flaky** → check its tier first. Flakiness in an acceptance spec almost always means the assertion should be a contract-tier check; flakiness in a unit test almost always means hidden I/O needs to be mocked.

---

## Canonical step vocabulary

The phrases below are load-bearing across multiple Epics and MUST be
reused verbatim — do not author a near-match.

- **`Given I am signed in as {string}`** — defined in
  [`apps/web/e2e/steps/auth.steps.ts`](../apps/web/e2e/steps/auth.steps.ts).
  Accepts the persona labels `'athlete'`, `'coach'`, `'org admin'`,
  `'dev admin'` (and `'anonymous'`). Drives Clerk's canonical
  `@clerk/testing/playwright` sign-in helper for the named persona via
  the seam at
  [`packages/shared/src/testing/auth.ts`](../packages/shared/src/testing/auth.ts),
  signing in as the seeded test-instance user
  (`<persona>@example.com`) with the shared
  `CLERK_TEST_USER_PASSWORD`. There is no dev-only auth bypass; the
  seam targets a real Clerk **test instance**. An unknown label throws
  a `TypeError` listing the accepted spellings — scenario typos fail
  loudly. See
  [`docs/patterns.md` § *Authenticated test sessions*](patterns.md#authenticated-test-sessions-clerk-test-instance)
  for the persona ↔ role table, the env-var surface, and the rotation
  runbook.
- **`Given I am not signed in`** — same file. Clears any session cookie
  planted by a prior step (or by a cached persona `storageState`) so the
  scenario starts from a known anonymous baseline.

## Adding a new step

Before authoring a new step definition:

1. **Grep the step library first.** New steps are a cost — they fragment the vocabulary. If a phrase already exists, reuse it verbatim and rephrase the scenario to fit, not the other way round. If a near-match exists, widen the parameter (e.g. swap a literal for `{string}`) and update every call site in the same PR.
2. **Pick the right file.** Keep concerns co-located: auth in `auth.steps.ts`, selectors/visibility in `visibility.steps.ts`, form interactions in `form.steps.ts`, RBAC outcomes in `rbac.steps.ts`, domain-specific work in a per-domain file.
3. **Honor the tier boundaries.** A step body asserts user-visible outcomes only. HTTP status codes, DB row state, JSON shapes, and raw SQL belong in contract tests — see the assertion-placement rule above. The step-definition linter enforces this.
4. **Reference the new step from a scenario in the same PR.** Unused steps are warnings on PR runs and become build failures at Epic close.
5. **Run the linter.** `pnpm run lint:steps` executes locally the same checks that run in CI.

---

## How the sizing was counted

The sizing table at the top of this document is hand-rolled — there's no automated sizing report yet (a future Story may add `scripts/test-corpus-counts.mjs` to lift this into CI). Until then, regenerate the counts with the commands below and update the table in the same PR that materially changes the corpus shape (adds a workspace, deletes a domain, migrates a tier).

```bash
# Unit + contract files, per workspace
find apps/web/src packages/shared/src packages/baselines/src apps/api/src \
  -name "*.test.ts" -o -name "*.test.tsx" | grep -v contract

find apps/api/src packages/shared/src -name "*.contract.test.ts"

# Test cases (it/test calls) per file
grep -rcE "^\s*(it|test)\(" <file>

# Acceptance scenarios
find tests/features -name "*.feature"
grep -rE "^\s*(Scenario|Scenario Outline):" tests/features | wc -l

# Step phrases (Given/When/Then definitions)
grep -rE "^\s*(Given|When|Then)\(" apps/web/e2e/steps
```

The counts should be re-run when the gap between the documented size and the actual corpus exceeds ~10% in any tier, or whenever a workspace is added or removed.
