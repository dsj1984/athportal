# Testing Strategy

> The generic tier rules live in [`.agents/rules/testing-standards.md`](../.agents/rules/testing-standards.md); this document maps those rules onto the concrete tools, paths, and workspaces this repo uses. When `AGENTS.md`, `CLAUDE.md`, or `docs/patterns.md` talk about testing, they defer to this file — do not duplicate rules across documents.
>
> The three tiers (unit, contract, acceptance) are wired today: Vitest projects run unit + contract under `pnpm run test`, the smoke acceptance scenario runs under `pnpm --filter @repo/web exec bddgen && pnpm --filter @repo/web test:e2e -- --grep @smoke`, and the step-definition linter runs under `pnpm run lint:steps`. CI ([`quality.yml`](../.github/workflows/quality.yml)) gates every PR on the three; the nightly schedule ([`nightly.yml`](../.github/workflows/nightly.yml)) runs the full acceptance corpus and the Stryker mutation report.

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

## Per-Layer Skeletons

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

## Coverage expectations

- **Line / branch coverage** — measured at the unit tier only. The RBAC policy module carries a ≥95% branch-coverage floor; other packages follow each workspace's Vitest config default.
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
