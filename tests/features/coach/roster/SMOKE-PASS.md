# Coach roster feature bundle — SMOKE-PASS verdict

This file records the SMOKE-PASS verdict for the coach roster feature
bundle, per Epic #11 / Story #929 / Task #936 and the contract in
[`docs/testing-strategy.md` § QA Corpus](../../../docs/testing-strategy.md#qa-corpus).

**Verdict definition.** Per the QA Corpus contract, "SMOKE-PASS" for a
`.feature` bundle means: the acceptance runner can load every file,
recognize every scenario, and emit a deterministic verdict (pass or
skip) for each. It does **not** require every scenario to be green —
pending scenarios tagged `@pending` (the runner's pending tag, set on
the [`apps/web/playwright.config.ts`](../../../apps/web/playwright.config.ts)
`defineBddConfig({ tags: 'not @pending' })`) are an acceptable
deterministic verdict.

## Bundle

| File | Scenarios | Tag posture |
| --- | --- | --- |
| [`digital-roster.feature`](./digital-roster.feature) | 7 (AC-1, AC-9, AC-10, AC-11, AC-12, AC-13, AC-14) | All `@pending` until step library lands |
| [`roster-invites.feature`](./roster-invites.feature) | 5 (AC-4, AC-5, AC-6, AC-7, AC-8) | All `@pending` until step library lands |
| [`team-scoped-access.feature`](./team-scoped-access.feature) | 2 (AC-2, AC-3) | All `@pending` until step library lands |

Total: 14 scenarios mapped 1:1 to AC-1…AC-14 in Acceptance Spec #907.

## Verification

Re-runnable from `apps/web/`:

```bash
pnpm exec bddgen --tags "@epic-11"
```

The command parses every coach roster feature file, lists every
scenario's missing step bindings (because the step library lands in a
later Epic), and exits 0. That parse-and-enumerate behavior is the
deterministic SMOKE-PASS signal: the runner sees the bundle.

With the production filter (`tags: 'not @pending'`, the default in
`playwright.config.ts`), `pnpm exec bddgen` deterministically excludes
every coach roster scenario from spec generation — the same
deterministic verdict, expressed as "skip" rather than "pass."

## Promotion

Each scenario sheds its `@pending` tag in the PR that lands the
matching step bindings (one Epic per surface — coach roster send/accept
flow, jersey-number edit flow, etc.). Removing the tag from a scenario
that still lacks a step binding is a review blocker — `bddgen` will
fail with a missing-step error and the CI `acceptance-smoke` job will
go red.
