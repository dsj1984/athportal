# lint-steps rejecting fixtures

Per-rule rejecting fixtures for `scripts/lint-steps.mjs`. Each fixture is
intentionally broken so the linter's AC-5 evidence harness can prove the
rule is wired and catches its target pattern.

| Fixture file | Expected rejection code |
| --- | --- |
| `raw-sql.steps.ts` | `no-raw-sql` |
| `status-code.steps.ts` | `no-status-code` |
| `dom-selector.steps.ts` | `no-dom-selector` |
| `api-url.steps.ts` | `no-api-url-literal` |
| `duplicate-phrase-a.steps.ts` + `duplicate-phrase-b.steps.ts` | `no-duplicate-phrase` |

## Run the harness

```bash
pnpm run lint:steps:fixtures
```

The harness walks this directory, runs `scripts/lint-steps.mjs` against
each fixture (or pair), and asserts that exactly the expected rule code
fires — no false positives, no rule misattribution. A passing run prints:

```
✓ scripts/__fixtures__/lint-steps/raw-sql.steps.ts  rejected by [no-raw-sql]
✓ scripts/__fixtures__/lint-steps/status-code.steps.ts  rejected by [no-status-code]
...
```

## Scope safety

These files live under `scripts/__fixtures__/lint-steps/`, **not** under
`apps/web/e2e/steps/`, so the production linter (`pnpm run lint:steps`)
never picks them up. The path-scoped exclusion is what makes it safe to
ship intentionally-broken `.steps.ts` files alongside real ones.

Both Biome and ESLint exclude this tree (see the `files.ignore` entry in
`biome.json` and the `ignores` block in `eslint.config.mjs`), and an
`.eslintignore` sibling is kept here for older tools that still honor
flat-file ignores.

## Adding a new rule

Per AC-5 in Story #176, a new forbidden-pattern rule only needs:

1. A new sibling fixture file (`my-new-rule.steps.ts`) in this directory.
2. An entry in `FIXTURE_EXPECTATIONS` in `scripts/lint-steps.mjs` mapping
   the fixture name → expected rule code.
3. A paired Vitest test in `scripts/__tests__/lint-steps.test.mjs`.

No changes to the harness driver itself are required.
