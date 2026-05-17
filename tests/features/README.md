# `tests/features/` — Cross-platform acceptance corpus

Scenarios in this tree are the single source of truth for user-visible
behavior across every client. They are authored once at the repo root and
bound by each platform runner against its own step library: the web runner
(Playwright + playwright-bdd) lives at [`apps/web/e2e/steps/`](../../apps/web/e2e/steps/);
the mobile runner (Detox + Jest binder) will wire in at v1.0 under
`apps/mobile/e2e/steps/`. One scenario, two bindings, two runtime
executions.

A scenario with **no `@platform-*` tag** is cross-platform-ready by default.
Apply `@platform-web` or `@platform-mobile` only when the underlying AC is
genuinely platform-specific. Authoring against the web runner first does not
make a scenario web-only.

Authoring rules — tag taxonomy, forbidden patterns (no DOM selectors, URLs,
HTTP status codes, JSON shapes, SQL, framework names), step-reuse workflow,
and `Scenario Outline` conventions — live in
[`.agents/rules/gherkin-standards.md`](../../.agents/rules/gherkin-standards.md).
Tier responsibilities (what belongs in unit vs contract vs acceptance) live
in [`.agents/rules/testing-standards.md`](../../.agents/rules/testing-standards.md)
and [`docs/testing-strategy.md`](../../docs/testing-strategy.md).
