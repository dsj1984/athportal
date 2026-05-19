# ADR-0006 — Local hook stack v1 (knip + markdownlint + secretlint + pre-push wiring)

**Status**: Accepted (2026-05-18, Story #310)

**Context**: The repo's local quality gates were uneven going into Q2
2026. Husky `pre-commit` ran Biome on staged files and the
step-definition linter, and `commit-msg` ran commitlint, but no
`.husky/pre-push` existed — every developer's `git push` either
succeeded or was rejected by CI minutes later. Three lint surfaces that
the sister projects ([domio](https://github.com/dsj1984/domio),
[mandrel](https://github.com/dsj1984/mandrel)) treated as table stakes
were also absent: cross-file dead-code detection (`knip`), markdown
linting (`markdownlint-cli2`), and a local secret scanner
(`secretlint`) that shifts-left from the CI-tier
TruffleHog + gitleaks pair. This ADR records the design of the
first-cut local hook stack that lands all four together, plus the
rationale for the per-surface scope and posture decisions taken in the
delivering Story.

The bundling is deliberate: every component touches `.husky/pre-push`,
`lint-staged.config.js`, or the root `package.json` script surface;
splitting them into separate PRs would produce three small changes
landing on the same three files with the reviewer's eye-time
dominated by the hook-stack diff regardless.

## Decision

### Three-stage local gate

| Stage | Scope | Purpose | Wall-clock budget |
| --- | --- | --- | --- |
| `pre-commit` | Staged files (`biome --staged` + `lint-staged` fan-out) | Format, organise imports, lint markdown, local secret scan | < 5 s on a typical diff |
| `pre-push` | Full repo (`pnpm run typecheck`, `lint`, `knip:fast`, baseline ratchets, step linter) | Local mirror of the PR-blocking CI gates so a push never sends work CI will reject | < 15 s on a clean tree |
| CI (`quality.yml`) | Full repo + extra slow gates | Full-strict `knip:strict`, mutation, lighthouse, supply-chain audit, secret-scanner pair | per the workflow |

The three layers are intentionally redundant by design — each one is
the correct trust boundary for a different latency / scope envelope.
`secretlint` runs at `pre-commit` (the staged set, where the developer
can still amend before the commit reaches the branch); the strict
`knip` pass runs in CI only (it traverses the full type-export graph
and is too slow for a push hook); markdownlint runs everywhere it's
fast enough to (pre-commit on staged `.md` files, pre-push full repo,
and CI as a required check).

### Secret-scanning four-channel boundary

Secret scanning runs across four distinct channels, each owning a
distinct scope so no two scanners gate the same diff:

| Channel | Scanner | Scope | Trigger |
| --- | --- | --- | --- |
| Pre-commit (local) | `secretlint` | Staged diff | `lint-staged` fan-out in `.husky/pre-commit` |
| PR (CI) | `gitleaks-pr` | PR diff | `pull_request` in [`quality.yml`](../../.github/workflows/quality.yml) |
| Post-merge full-history (CI) | `gitleaks-history` | Full git history | `push` to `main` in [`secret-scan-push.yml`](../../.github/workflows/secret-scan-push.yml) |
| Nightly full-history (CI) | `trufflehog` | Full git history, provider-verified | `schedule` in [`nightly.yml`](../../.github/workflows/nightly.yml) |

The boundary is owner-disjoint: `secretlint` owns the pre-commit
local window, `gitleaks-pr` owns the PR diff, `gitleaks-history`
owns the post-merge full-history scan, and `trufflehog` owns the
nightly full-history verified-only scan. Earlier revisions of this
ADR ran `trufflehog` and a redundant `secretlint` job on every PR
alongside `gitleaks-pr`; those two PR-tier jobs were dropped
(Story #401) because they re-scanned the same PR diff `gitleaks-pr`
already covered, and demoting `trufflehog` to nightly preserves its
distinct value (provider-verified findings across the entire commit
graph) without redundantly gating merge velocity on the PR tier.

### Per-surface posture

#### `knip` — strict, no baseline

- **Posture**: strict — `--reporter compact` exits non-zero on any
  finding. No `.knip-baseline.json`, no tolerance window.
- **Why no baseline**: the codebase is young enough that the initial
  signal is manageable (the delivering Story fixed every existing
  finding rather than pinning them). A baseline file is a maintenance
  artifact in its own right — every removal-then-re-introduction of a
  finding requires a baseline refresh, and the failure mode is silent
  drift upward. Removing the baseline from the design removes that
  failure mode. If the project later outgrows strict mode, the
  baseline lever exists in the tool — adoption is a one-line config
  change.
- **`knip:fast` (pre-push) vs `knip:strict` (CI)**: the push hook
  scopes to `--include files,dependencies` so the expensive
  unused-exports graph traversal (the slow part) runs in CI only. The
  fast variant catches the regression classes most likely to arise
  from a half-finished branch — orphan files and unlisted
  dependencies — without paying for the full graph walk on every
  push.
- **Plugin handling**: the `expo`, `vitest`, `playwright`, `astro`,
  `biome`, `eslint`, and `husky` plugins are auto-detected from each
  workspace's `package.json` and config files. The config file
  ([`knip.config.ts`](../../knip.config.ts)) only declares overrides
  for things the plugins can't infer (workspace-specific entry
  points; the small `ignoreDependencies` list for deps consumed by
  the `.agents/` submodule, `.husky/` shell hooks, or
  `.secretlintrc.json`).

#### `markdownlint-cli2` — relaxed line-length, default everything else

- **Posture**: lean on markdownlint's defaults; relax three rules
  that conflict with the project's writing conventions:
  - `MD013` (line length) — prose wraps at natural break points,
    not a column count.
  - `MD060` (table column style) — tables embed markdown links and
    varying-width cells; auto-aligning every pipe would require
    visually wide tables or constant re-formatting on every edit.
  - `MD041` (first line h1) — some docs lead with a callout
    blockquote.
  - `MD033` (inline HTML) — permit common embed/expand patterns.
- **Scope**: full repo (`**/*.md`) minus `node_modules`, the
  `.agents/` submodule, `.claude/` (auto-generated command mirrors
  from `.agents/workflows/`), `.worktrees/`, `temp/`, `dist/`,
  `coverage/`, `.bdd-gen/`, and the deliberately-broken
  `scripts/__fixtures__/` corpus.
- **Hooks**: pre-commit (staged `.md` files via lint-staged) and
  pre-push (full repo via the umbrella `lint` task, which runs
  `lint:js` and `lint:md` in parallel). CI re-runs the full check
  as a required PR gate.

#### `secretlint` — pre-commit only, recommended preset

- **Posture**: `@secretlint/secretlint-rule-preset-recommend`. No
  custom rules in the first cut — the preset already covers the
  vendor patterns most likely to show up in this project (Clerk,
  Stripe, AWS, Slack, GitHub tokens).
- **Why pre-commit only**: by the time the commit reaches `pre-push`,
  the secret is already past the local trust boundary. The
  post-commit / pre-push window is too late to amend without
  rewriting history. Push-time scanning is a CI concern — `gitleaks`
  covers the PR diff on every PR via
  [`quality.yml`](../../.github/workflows/quality.yml) and the
  full git history on every push to `main` via
  [`secret-scan-push.yml`](../../.github/workflows/secret-scan-push.yml),
  and `trufflehog` (with `--only-verified`) re-scans the full
  history nightly via
  [`nightly.yml`](../../.github/workflows/nightly.yml). See the
  *Secret-scanning four-channel boundary* table above for the
  channel-by-channel split.
- **`.env.example` exemption**: the template file's placeholder
  values (`sk_test_xxxxxxxx…`) intentionally match the real-key
  regex shape so readers see the right prefix. The file is listed in
  `.secretlintignore` (a sibling of `.gitignore` that `lint:secrets`
  layers on top); CI's `--only-verified` posture makes the same
  call. Any new file added to `.secretlintignore` requires a human
  review per the comment in the file — silent suppressions defeat
  the gate.

#### `.husky/pre-push` — sequential, fail-fast, no escape hatch

- **Posture**: sequential commands inside the hook script (the
  *steps* are sequential — `lint` itself parallelises its `js` and
  `md` subtasks internally). Fail-fast via `set -e`. No
  `--no-verify` carve-out beyond the global rule in
  [`.agents/rules/git-conventions.md`](../../.agents/rules/git-conventions.md)
  § Push Validation & Reliability (explicit operator authorization
  required to bypass).
- **Chain order** (cheapest-fail first):
  1. `pnpm run typecheck` — strict TS across all workspaces.
  2. `pnpm run lint` — biome + ESLint + markdownlint (parallel
     internally).
  3. `pnpm run knip:fast` — files + dependencies surfaces only.
  4. `pnpm run lint:baseline:check` — guards against new Biome
     warnings (lint-baseline ratchet).
  5. `pnpm run lint:steps` — BDD step-vocabulary linter.
- **What's NOT in the chain**:
  - `pnpm run test` — CI's job. Tests are too variable in latency
    to put in front of a push, and the unit + contract tiers are
    cached by Turborepo on every PR anyway.
  - `secretlint` — pre-commit owns it (see above).
  - The slow ratchets (coverage, CRAP, maintainability,
    bundle-size, mutation, lighthouse) — these stay CI-only because
    they require build output or coverage runs that don't fit a
    sub-15 s budget.

### Parallelization strategy

- **Inside `pnpm run lint`**: `lint:js` (Turborepo orchestrating
  biome + eslint across workspaces) and `lint:md` (markdownlint-cli2
  on the root glob) run in parallel via
  `pnpm -w run --parallel "/^lint:(js|md)$/"`. Turborepo handles its
  own intra-task parallelism (per workspace); `lint:md` is a single
  process running against a root-rooted glob. The `-w` flag pins the
  pattern to the workspace root so pnpm doesn't try to fan it out to
  child workspaces (which would find no matching scripts).
- **Inside `pre-push`**: sequential. The chain is fail-fast and the
  individual steps each have their own internal parallelism; an
  outer parallel runner would obscure which step failed and slow
  cold-start (each step would race for the same npm cache).

### Wall-clock budget

| Hook | Target | Where it spends time |
| --- | --- | --- |
| `pre-commit` | < 5 s on a typical diff | `biome --staged` + lint-staged fan-out; secretlint is the slowest at 1–2 s |
| `pre-push` | < 15 s on a clean tree | Turborepo cache hits keep `lint` + `typecheck` near-instant; `knip:fast` is the dominant cold-cache step at 2–4 s |
| `commit-msg` | < 500 ms | commitlint parse of the subject line |

The budgets are advisory — fail-loud behaviour is on rule violations,
not on overruns. A regression in hook latency is its own conversation
(see the "Hooks slow" symptom in the runbook).

## Rejected alternatives

**Rejected — full `knip` (with unused-exports) on pre-push**: too
slow. On a clean tree the full graph traversal takes 6–8 s by itself,
which would push the pre-push budget over 15 s. The `--include
files,dependencies` scope keeps the cheapest-to-detect classes
(orphan files, unlisted deps) on the hot path and defers the slow
class to CI.

**Rejected — `knip` with a baseline**: pinning existing findings
trades one maintenance cost (fixing the findings once) for a
recurring cost (refreshing the baseline every time something moves).
The codebase is small enough that the one-time fix is bounded. If
the project grows to a size where the strict posture stops scaling,
the baseline lever is in the tool and a follow-on ADR can adopt it.

**Rejected — `secretlint` on `pre-push`**: redundant with the CI
`gitleaks-history` post-merge scan and the nightly `trufflehog`
scan on the same scope (full history), and slower than the
pre-commit window where the developer can still amend. Adding it
to pre-push would also fight the staged-only posture lint-staged
is built for — `pre-push` runs against committed history, which
secretlint would have to re-scan from scratch.

**Rejected — single umbrella `lint` task without internal
parallelism** (`lint:js && lint:md` sequential): wall-clock cost of
`lint:md` is 1 s and `lint:js` is 10 s; the sequential form costs
~11 s on the push hook vs ~10 s parallel. The parallel form pays
for itself when both surfaces grow.

**Rejected — `lint-staged` driving the whole pre-commit (replacing
the bare biome + step-lint shell calls)**: lint-staged is the right
tool for extension-keyed fan-out (`.md` → markdownlint, `*` →
secretlint), but biome's own `--staged` mode plus the step-linter's
own `--staged` flag are cheaper to call directly than to wrap. The
hook keeps the bare calls for biome + step-lint and uses lint-staged
for the rest.

## Consequences

- A new contributor's first `git push` after cloning runs the same
  gates CI does, so the "works locally, fails on PR" loop is closed
  for the regression classes the pre-push chain covers.
- The `.husky/pre-push` file is now load-bearing — disabling it
  (e.g. via `core.hooksPath = /dev/null`) bypasses the local CI
  mirror. Reviewers should call this out if the change touches
  `.husky/`.
- `knip` failures are the new "did I leave an orphan file?" signal.
  When a refactor deletes the last importer of a file or dep, the
  next `git push` fails with the named orphan; the fix is to delete
  the orphan in the same change.
- `markdownlint` becomes the canonical writer-side gate for prose
  hygiene. The relaxed rule set ([`.markdownlint.jsonc`](../../.markdownlint.jsonc))
  is the SSOT — extending it requires a paired ADR or, for
  rule-relaxation only, a comment in the JSONC file naming the
  reason.
- `secretlint` makes a *committed* secret a one-step rollback rather
  than a multi-step incident response. The
  [security baseline](../../.agents/rules/security-baseline.md)
  § "Secrets Management" remains the authoritative policy; this gate
  is its local enforcement.

## Cross-references

- [`.agents/rules/git-conventions.md`](../../.agents/rules/git-conventions.md)
  § Push Validation & Reliability — the `--no-verify` carve-out
  policy this hook stack relies on.
- [`.agents/rules/security-baseline.md`](../../.agents/rules/security-baseline.md)
  § Secrets Management — the canonical policy `secretlint` enforces
  locally.
- [`README.md` § "Local hooks"](../../README.md#local-hooks) — the
  human-facing summary of the three-stage gate and what each hook
  enforces.
- [`docs/patterns.md` § "Lint baseline ratchet"](../patterns.md#lint-baseline-ratchet)
  — the in-place baseline that pre-push step 4 calls into.
