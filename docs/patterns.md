# Patterns

This file is the project's living catalogue of cross-cutting engineering
patterns. Sections below cover only what the current scaffolding requires;
new patterns land here as Stories add them.

## Primitive library — import this, not Tailwind classes {#primitive-library}

> **Rule.** Every consumer surface under `apps/web/` composes against
> the design-system primitives at `apps/web/src/components/ui/*`. Do
> not author bespoke buttons, cards, badges, inputs, or event chips in
> a consuming Epic — extend the primitive (or its `_lib` sibling)
> instead, in a PR scoped to that primitive.

Epic #702 codified the canonical primitive library. The companion
[`docs/style-guide.md`](style-guide.md) carries the design rules; this
section carries the **engineering** rules. The live, gated reference
page lives at `/internal/styleguide`
([source](../apps/web/src/pages/internal/styleguide.astro)).

### Import path

All primitives live under a single root and import via the workspace
alias:

```ts
// ✅ Correct — import the primitive
import Btn from '@/components/ui/Btn.astro';
import Card from '@/components/ui/Card.astro';
import { toast } from '@/components/ui/_lib/toast';

// ❌ Wrong — bespoke Tailwind on a one-off
// <button class="rounded-md bg-brand px-4 py-2 text-white ...">
```

The `_lib/` subfolder under `apps/web/src/components/ui/` holds the
pure-TS helpers each primitive composes against (colour maps, class
builders, registries). Import from `_lib/<helper>` when you need the
helper itself (e.g. a screenshot fixture seeding the same colour
palette); never reach past `_lib/` for an "internal" symbol that
wasn't exported.

### Available primitives (Epic #702 — Waves 0–2)

The catalogue below mirrors what `/internal/styleguide` renders. Each
primitive is the **only** sanctioned surface for its concept — author a
new atom inside `_lib/` if you need an option that isn't there yet.

| Category | Primitive | Import |
| :------- | :-------- | :----- |
| Interactive atom | `Btn`          | `@/components/ui/Btn.astro` |
| Interactive atom | `Input`        | `@/components/ui/Input.tsx` |
| Interactive atom | `Select`       | `@/components/ui/Select.tsx` |
| Interactive atom | `Textarea`     | `@/components/ui/Textarea.tsx` |
| Display atom     | `Badge`        | `@/components/ui/Badge.astro` |
| Display atom     | `Stat`         | `@/components/ui/Stat.astro` |
| Display atom     | `Ring`         | `@/components/ui/Ring.astro` |
| Display atom     | `Avatar`       | `@/components/ui/Avatar.astro` |
| Display atom     | `VerifiedTick` | `@/components/ui/VerifiedTick.astro` |
| Display atom     | `Ph`           | `@/components/ui/Ph.astro` |
| Display atom     | `Logo`         | `@/components/ui/Logo.astro` |
| Composite        | `Card`         | `@/components/ui/Card.astro` |
| Composite        | `CardSoft`     | `@/components/ui/CardSoft.astro` |
| Composite        | `Shell`        | `@/components/ui/Shell.astro` |
| Composite        | `Topbar`       | `@/components/ui/Topbar.astro` |
| Composite        | `Sidebar`      | `@/components/ui/Sidebar.astro` |
| Composite        | `EmptyState`   | `@/components/ui/EmptyState.astro` |
| Composite        | `EventChip`    | `@/components/ui/EventChip.astro` |
| Composite        | `ToastHost`    | `@/components/ui/ToastHost.tsx` |

### No restyling per Epic

A consuming Epic **must not** re-style a primitive at its call site.
The acceptable extension paths are:

1. **Add a prop** to the primitive in a PR scoped to that primitive
   (and add the corresponding line to `/internal/styleguide`).
2. **Extend the `_lib/` registry** (e.g. add a new event_type to
   [`_lib/eventColors.ts`](../apps/web/src/components/ui/_lib/eventColors.ts)
   in the same PR that extends the `EventType` union).
3. **Add a new primitive** when none of the existing ones cover the
   concept. The new file lives under `apps/web/src/components/ui/`
   alongside its sibling `*.ts` view-builder and `*.test.ts` unit
   test; the live page picks it up automatically.

What you **must not** do: override token values in a page-level CSS
file, inline a custom `border-radius` or `box-shadow` to bypass the
scales in [`docs/style-guide.md` § 3.5](style-guide.md#3-5-radii--elevation-epic-702),
or copy-paste primitive markup into a one-off component. The
[`docs/style-guide.md` § 3.4 soft-badge rule](style-guide.md#3-4-component-styling-translucent-soft-badges)
and the [§ 4.6 EventChip rules](style-guide.md#4-6-calendar--event-chip-styling-epic-466)
are the canonical references the primitives compose against; they are
not advisory.

### Toast helper

Toasts go through a single seam so the toast surface can be swapped
(or wrapped with telemetry) in one file:

```ts
import { toast } from '@/components/ui/_lib/toast';

toast.success('Saved');
```

Source:
[`apps/web/src/components/ui/_lib/toast.ts`](../apps/web/src/components/ui/_lib/toast.ts).
Do not import directly from `sonner` (or any other toast library) in
a consumer — every toast call site reads from `_lib/toast`.

### lucide-react icon catalogue

Icons across the platform come from
[`lucide-react`](https://lucide.dev/). The platform follows the
[`docs/style-guide.md` § 1 anti-cliché rule](style-guide.md#1-core-design-philosophy)
— prefer abstract, geometric glyphs over literal sports clip-art.

`Sidebar.astro` resolves icons dynamically by name from the
`SIDEBAR_NAV` registry at
[`apps/web/src/components/ui/_lib/sidebarNav.ts`](../apps/web/src/components/ui/_lib/sidebarNav.ts).
The canonical persona → nav-set mapping uses the following icons (each
name resolves to the same-named `lucide-react` export):

| Persona | Nav row | `lucide-react` icon |
| :------ | :------ | :------------------ |
| athlete | Home            | `Home` |
| athlete | My profile      | `User` |
| athlete | My teams        | `Users` |
| athlete | Calendar        | `Calendar` |
| athlete | Team feed       | `MessageSquare` |
| athlete | Stats & awards  | `Trophy` |
| coach   | Home            | `Home` |
| coach   | Roster          | `Users` |
| coach   | Verify stats    | `CheckSquare` |
| coach   | Calendar        | `Calendar` |
| coach   | Team feed       | `MessageSquare` |
| coach   | Announcements   | `Megaphone` |
| org     | Overview        | `LayoutDashboard` |
| org     | Teams           | `Users` |
| org     | Coaches         | `UserCheck` |
| org     | Athletes        | `GraduationCap` |
| org     | Events          | `Calendar` |
| org     | Reports         | `BarChart3` |

When adding a new nav row (or a new persona) extend `SIDEBAR_NAV` in
the same PR — `resolveSidebarNav` throws `TypeError` on an unknown
persona, so an upstream typo fails loudly at boot. Add the row to the
table above in the same PR so the docs stay aligned with the live
registry.

For icons outside the sidebar (inline status indicators, action
buttons), import the lucide component directly:

```tsx
import { CheckCircle2, AlertTriangle } from 'lucide-react';
```

Stick to glyphs that read as connectivity, verification, or data flow.
Never introduce literal whistles, soccer balls, or distressed-block
sports glyphs — see [`docs/style-guide.md` § 1](style-guide.md#1-core-design-philosophy).

## Design explorations are directional, not canonical {#design-explorations}

Point-in-time UI exploration bundles (e.g. Claude Design handoffs) live
under [`docs/design-explorations/<date>-handoff/`](design-explorations/)
and are **directional, not canonical**. They predate and inform the
primitive library but do not constrain it. The canonical UI sources of
truth are:

- [`docs/style-guide.md`](style-guide.md) (rules + copy conventions)
- [`apps/web/src/styles/global.css`](../apps/web/src/styles/global.css)
  (tokens)
- [`apps/web/src/components/ui/`](../apps/web/src/components/ui/)
  (primitives)
- `/internal/styleguide` (live primitive reference — run
  `pnpm --filter @repo/web dev`)

When an exploration disagrees with a canonical source, **the canonical
source wins**. See
[`docs/design-explorations/README.md`](design-explorations/README.md)
for the recommended PRD reference template and the sunset triggers for
overtaken mockups.

## Linting: Biome ↔ ESLint scope boundary

The repo uses **two linters with non-overlapping concerns** so each tool
runs at its strengths without fighting the other. The single rule that
resolves every edge case: **when in doubt, Biome wins.** ESLint exists
only to cover rule classes Biome cannot express (today: type-aware
rules; tomorrow: framework-specific plugins).

- **Biome** (`biome.json`) is the **primary** linter and the **sole
  formatter**. It owns formatting, organize-imports, and the universal
  correctness / suspicious / style recommended sets. Biome runs on every
  file the workspace globs match and is the fast-feedback loop driving
  editor-on-save, the Husky `pre-commit` hook, and `pnpm run lint:biome`.
- **ESLint 9 flat config** (per-workspace `eslint.config.mjs`, once the
  workspaces exist) is the **secondary** linter, opt-in per workspace.
  It runs only the rule classes Biome cannot cover — currently the
  type-aware rules from `typescript-eslint` (`no-floating-promises`,
  `no-misused-promises`, etc.) and, in future, framework plugins
  (`eslint-plugin-react`, `jsx-a11y`, `eslint-plugin-astro`, …).
  `eslint-config-prettier` is appended last so any stylistic rule that
  sneaks in via a plugin is neutralized — style belongs to Biome.

Both linters emit JSON reports that the baseline ratchet (see next
section) aggregates into a single per-file warning tally — they are
complementary, not redundant.

### Decision table — which tool owns which rule class

| Rule category                                   | Owner       | Why                                                                                                               |
| ----------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------- |
| Formatting (indent, quotes, semicolons, width)  | **Biome**   | Biome is the sole formatter; Prettier is intentionally absent and `eslint-config-prettier` enforces the absence.  |
| Import ordering / organize-imports              | **Biome**   | Biome's `organize-imports` is the canonical pass; ESLint must not duplicate it.                                   |
| Universal correctness (e.g. `no-unused-vars`, `no-debugger`, `useExhaustiveDependencies`) | **Biome** | Covered by Biome's `recommended` correctness/suspicious sets; no type-checker needed.                              |
| Style / opinion (e.g. `useConst`, `useTemplate`)| **Biome**   | Biome's `style` recommended set is the project's style policy.                                                    |
| Type-aware lint (`no-floating-promises`, `no-misused-promises`, `await-thenable`, `no-unsafe-*`) | **ESLint** | Requires the TypeScript type-checker — Biome cannot run these today.                                              |
| Framework plugins (React hooks rules, JSX-a11y, Astro, Next.js, etc.) | **ESLint** | Biome has no equivalent plugin surface; ecosystem plugins ship as ESLint rules.                                   |
| Test-framework plugins (jest, vitest, playwright) | **ESLint** | Same reason as framework plugins — ecosystem ships ESLint rules.                                                  |
| Conflict / overlap between the two              | **Biome wins** | If both tools can express a rule, disable it in ESLint and let Biome own it; `eslint-config-prettier` enforces this for stylistic overlap. |

When adding a new lint rule:

1. Check Biome's recommended sets first. If Biome already covers it (or
   could cover it via a flag), enable it there and stop.
2. If the rule requires the TypeScript type-checker, add it to the
   relevant ESLint flat config.
3. If the rule is framework-specific (React/JSX/Astro/etc.), add it via
   the appropriate ESLint plugin to the consuming workspace's flat
   config, not to the shared base.
4. If you find yourself disabling a Biome rule to "let ESLint handle
   it" — stop. That is the conflict case; Biome wins. Disable the ESLint
   rule instead.

### What each workspace's `lint` script covers (post-Story #374)

Every workspace's `lint` script runs `pnpm exec biome check . && pnpm
exec eslint .` against the workspace cwd. The intersection of the
workspace tree with `biome.json` `files.include` and
`eslint.config.mjs` `files`/`ignores` produces the actual lint set —
which now includes:

- workspace `src/**`,
- workspace-root config files (`vitest.config.ts`,
  `playwright.config.ts`, `astro.config.ts`, `app.config.ts`,
  `drizzle.config.ts`, `vitest.base.ts`, `vitest.contract.ts`),
- the web `e2e/**` step library.

Pre-Story #374 the scripts only checked `src/`. Anything outside `src/`
was invisible to the workspace gate, IDE-on-save, and pre-commit; the
only catcher was the root baseline sweep. The widened scope makes the
workspace gate honest with the baseline gate.

When adding a new top-level TS file outside `src/` (a new config, a new
glue script), add its glob to **both** `biome.json` `files.include`
**and** the `eslint.config.mjs` `toolingConfig` overlay so the two
linters stay aligned. Story #373's `tsconfig.tooling.json` already
covers the typed-lint side.

## Dependency boundaries (dependency-cruiser) {#dependency-boundaries}

Story #590 added [`dependency-cruiser`](https://github.com/sverweij/dependency-cruiser)
as the canonical architecture-boundary enforcer. The rules in
[`.dependency-cruiser.cjs`](../.dependency-cruiser.cjs) encode the
workspace invariants described in [`architecture.md`](architecture.md)
§§ 1–2, 3.4, and 5 plus the safety constraints in `AGENTS.md`.

### What each rule means

| Rule name | Plain-English meaning |
|---|---|
| `no-circular` | Zero import cycles anywhere under `apps/**` or `packages/**`. |
| `no-orphans` | Every source module is either imported by something else or explicitly listed as an entry point (Astro middleware/pages, Sentry init, env shape, RBAC types re-exported via `@repo/shared`). |
| `not-to-unresolvable` | An import that the resolver can't follow is a build-time error in disguise — fail at lint time. |
| `no-deprecated-core` | No imports of deprecated Node core modules. |
| `not-to-dev-dep` | Production source can't import devDependencies. Tests, fixtures, and the published `packages/shared/src/testing/**` surface are exempt. |
| `shared-must-not-depend-on-apps` | `@repo/shared` is the substrate; it can't reach into `apps/**`. |
| `apps-must-not-cross-import` / `api-must-not-import-web` | `apps/web` and `apps/api` are independent runtimes. The only sanctioned coupling is `@repo/api`'s exported `AppType` consumed via Hono RPC, which goes through `@repo/shared`, never a relative path. |
| `mobile-must-not-cross-import` | `apps/mobile` can't reach into `apps/web` or `apps/api`; shared types go through `@repo/shared`. |
| `no-relative-apps-to-packages` | Cross-workspace imports must use the `@repo/*` aliases, not relative `../../packages/...` paths. The other quadrants are covered by the directional rules above. |
| `test-helpers-only-in-tests` | `packages/shared/src/testing/**` holds the Clerk test-instance seam. Only test files, the testing surface itself, `apps/web/e2e/**`, and `tests/**` may import it — production code must never reach it, or the seam ships in production builds. |
| `drizzle-schema-owns-tables` | Only `packages/shared/src/db/schema/**` may import drizzle table builders. Redeclaring tables fractures the schema SSOT. |
| `auth-middleware-no-incoming-routes` | Route handlers read `c.var.auth` set upstream by `requireInternalUser`; they must not import `apps/api/src/middleware/auth.ts` directly. Contract tests are exempt — they wire the middleware into the harness deliberately. |

The "edge logger goes through redaction" invariant from
[`architecture.md` § 3.4](architecture.md#34-observability) is **not**
encoded as a `dependency-cruiser` `required` rule. Redaction is
re-exported through `@repo/shared`, and depcruise's `required` rule
checks direct edges only — once the import hops through the package
index, the chain is invisible. The file header in
[`apps/api/src/middleware/request-logger.ts`](../apps/api/src/middleware/request-logger.ts)
calls out the contract; manual review owns this one.

### Running the gate

- **Locally**: `pnpm run lint:deps` runs the validator and prints any
  violations to stdout. The mirroring unit-tier test
  [`scripts/__tests__/architecture-boundaries.test.mjs`](../scripts/__tests__/architecture-boundaries.test.mjs)
  runs under `pnpm run test` and surfaces the same signal inside the
  test corpus so violations show up in two places.
- **CI**: the `lint-deps` job in
  [`.github/workflows/quality.yml`](../.github/workflows/quality.yml)
  runs the same command on every PR and push to `main`, parallel to
  `lint-steps`.
- **Dependency graph (developer-only)**: `pnpm run lint:deps:graph`
  emits a DOT graph to `temp/dep-graph.dot` for ad-hoc inspection.
  Not wired into CI.

### Adding or relaxing a rule

1. Update [`.dependency-cruiser.cjs`](../.dependency-cruiser.cjs) in the
   same PR that produces the new shape — never on a follow-up.
2. Every rule carries a one-line `comment:` that links back to the
   architecture-doc section motivating it. If you can't write that
   sentence, the rule probably doesn't belong.
3. Allowlisting an exception (e.g. a single legitimate cross-workspace
   import) is done by tightening the rule's `from.pathNot` or `to.pathNot`
   with the specific path **and** a comment naming the ADR or PR that
   authorized the exception. Generic `pathNot` widening without
   justification is a review block.
4. If a new invariant requires the `required` rule shape, prefer a
   manual reviewer surface (file header + patterns.md note) when the
   target is re-exported through a package index — depcruise's `required`
   rule checks direct edges only and produces false positives when the
   chain goes through a re-export.

### No-ratchet policy

There is **no** baseline file and **no** ratchet mechanism for this
gate. A rule either holds across the whole workspace or it is explicitly
relaxed in the same PR. Violations cannot be deferred to a follow-up
story. The reasoning mirrors the
[hard-cutover convention](../.agents/rules/git-conventions.md#contract-cutovers--no-shim-layer)
that governs framework contract changes: shape is shape, and a partial
hold is just a slow break.

If encoding a new invariant exposes existing violations, fix the imports
in the same PR. If the diff would be too large, split the contract — not
the rollout.

## Lint baseline ratchet

The baseline ratchet runs **two channels** against every PR (Story #373):

- **Errors → zero, always.** Any non-zero `errorCount` in the current
  aggregate fails the gate, independent of what the committed baseline
  records. `--update` refuses to absorb errors into a new snapshot — they
  must be fixed in source. Story #374 widened the per-workspace `lint`
  scripts so this channel now catches **the same surface** as the root
  baseline sweep — no more silent gaps between `pnpm --filter <ws> run
  lint` and `pnpm run lint:baseline:check`.
- **Warnings ratchet downward.** Per-file warning regressions and any
  net-total warning increase fail the gate. Warnings are
  `--update`-absorbable when a regression is intentional (a new rule that
  flags existing call sites that will be cleaned up incrementally).

A PR cannot introduce a new error to any file, and cannot introduce a net
warning to any file (or to the total), without explicitly re-snapshotting
the baseline.

### Files and entrypoints

- [`scripts/lint-baseline.mjs`](../scripts/lint-baseline.mjs) — the
  ratchet script. Pure Node ESM, no build step. Runs Biome
  (`--reporter=json`) and ESLint (`--format=json`) with
  `child_process.spawnSync({ shell: false })` so it behaves identically
  under PowerShell and bash. Per-file warning **and error** counts are
  aggregated into the shared baseline envelope
  ([`.agents/schemas/baselines/lint.schema.json`](../.agents/schemas/baselines/lint.schema.json));
  rows are sorted lexicographically so successive runs against an
  unchanged tree produce byte-identical JSON.
- [`baselines/lint.json`](../baselines/lint.json) — the committed
  snapshot. Once Story #373 landed, `rollup.*.errorCount` is `0` and stays
  there.
- [`tsconfig.tooling.json`](../tsconfig.tooling.json) — root tooling
  tsconfig that lets typescript-eslint's project service locate
  workspace-level config files (Vitest, Playwright, Astro, Drizzle, app
  configs) and the web e2e step library. The
  [`eslint.config.mjs`](../eslint.config.mjs) tooling overlay points at
  this file and scopes a few typed-lint rules (`@typescript-eslint/no-unsafe-*`,
  `@typescript-eslint/require-await`) off for these glue paths — those
  rules add real value in `src/` but generate noise in framework configs
  that read untyped env (Astro `import.meta.env`) and in BDD step bodies
  that are uniformly `async` for binder consistency. Mirror this pattern
  when adding new top-level TS files outside any workspace's `tsconfig.json`
  `include`.
- `pnpm run lint:baseline:check` — runs the script in check mode. Exits
  non-zero if **any** error appears, any file gained warnings, or the
  warning total increased.
- `pnpm run lint:baseline:update` — runs the script in update mode.
  Rewrites `baselines/lint.json` from the current tree. Refuses to run
  while errors exist.

### Relationship to `quality:preview`

`pnpm run quality:preview` is the **operator-facing convenience** — it
delegates to `.agents/scripts/quality-preview.js --changed-since HEAD`
and surfaces maintainability and CRAP findings on the diff so issues
surface while the change is warm in working memory.

The baseline ratchet is a **separate CI gate**. Run it alongside (not
inside) `quality:preview`:

```sh
pnpm run quality:preview
pnpm run lint:baseline:check
```

Keeping them decoupled means an operator can iterate on a refactor with
`quality:preview` running on every save without re-spawning the
whole-tree Biome and ESLint passes the ratchet needs.

### Runbook

1. **`pnpm run lint:baseline:check` failed with `errors: N (blocking)`.**
   The check found `N` ESLint / Biome errors that the per-workspace lint
   scripts did not catch. Read the per-file list in stderr, run
   `pnpm exec eslint <file>` and `pnpm exec biome check <file>` against
   each named file to reproduce, fix in source, re-run check. **You cannot
   absorb errors with `--update`** — the script refuses, on the grounds
   that the error floor is zero and silently absorbing them defeats the
   gate. If a rule is genuinely wrong for a tooling file, scope it off in
   the [`eslint.config.mjs`](../eslint.config.mjs) tooling overlay (same
   shape as the existing `no-unsafe-*` / `require-await` scoping) and
   document why in the comment.
2. **`pnpm run lint:baseline:check` failed with a warning regression.**
   Read the stderr listing — it names the files that gained warnings, the
   previous per-file count, and the new count. Fix the new warnings at
   the call site, OR if the change is intentional re-run
   `pnpm run lint:baseline:update`, inspect the diff on
   [`baselines/lint.json`](../baselines/lint.json) to confirm the bump
   matches the change you expect, and commit the snapshot alongside the
   source change. Reviewers should see *both* the warning-introducing
   change and the baseline bump in the same PR.
3. **You fixed warnings and the baseline now over-counts.** Run
   `pnpm run lint:baseline:update` and commit the lowered snapshot so the
   next contributor cannot quietly re-introduce the warnings you just
   removed.
4. **A new top-level TS file (config, build script, glue) added in your
   PR fails parsing.** Add the file's path to
   [`tsconfig.tooling.json`](../tsconfig.tooling.json)'s `include`, and
   add the matching glob to the `files` array in
   [`eslint.config.mjs`](../eslint.config.mjs)'s `toolingConfig` overlay.
5. **Editor noise / local-only failures.** The ratchet runs the same
   linters as `pnpm run lint` and `pnpm exec eslint .`, so a `--check`
   failure that does not reproduce in `pnpm run lint` is a script bug,
   not a code bug — file an issue rather than working around it.

## Priming a baseline (Story #375 runbook)

The seven baseline ratchets (`coverage`, `crap`, `maintainability`,
`mutation`, `bundle-size`, `lighthouse`, `lint`) all share a common
contract: each `*:check` script either **fails on a regression** or
**fails-loud / skips-with-warning** when the baseline is *unprimed* — an
empty zero-rollup snapshot from before any real measurement landed. An
unprimed baseline is **not** a protective gate; it is decoration that
will pass green on a PR that's actually regressing the underlying
metric.

A baseline graduates from unprimed → enforcing in three steps:

1. **Generate a measurement.** Run the producer (`pnpm run test:coverage`
   for coverage, `pnpm run build` for bundle-size, the nightly Stryker
   job for mutation, etc.). The producer writes the artifact the
   ratchet reads.
2. **Snapshot.** Run `pnpm run <kind>:update`. The script reads the
   artifact, writes `baselines/<kind>.json` with real rollups + rows,
   and commits the diff alongside the producer change in the same PR.
3. **Prove the gate bites.** Open a draft PR that deliberately regresses
   the metric by an amount that crosses the gate's tolerance (e.g. -3pp
   on coverage with the ADR-015 -2pp floor), confirm the `*:check`
   fails, restore. Link both runs from the PR description.

### Per-baseline producer commands

| Baseline        | Producer                                                                                       | Where it writes                                                                                 |
| --------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| coverage        | per-workspace `pnpm --filter <ws> exec vitest run --coverage` — CI's `pnpm run test:coverage` writes only root `coverage/coverage-final.json`, but the ratchet reads per-workspace files. **Producer/consumer alignment is the open work for #384.** | `<ws>/coverage/coverage-final.json`                                                              |
| crap            | reuses coverage output (no separate producer)                                                  | reads `<ws>/coverage/coverage-final.json` + source AST                                          |
| maintainability | `pnpm run maintainability:update` runs the producer inline                                     | computed from source AST; no intermediate artifact                                              |
| bundle-size     | `pnpm run build` (per `turbo.json`)                                                            | `<ws>/dist/**` — when every `build` is `exit 0` the ratchet skips with `no measurable bundles` |
| mutation        | `pnpm run mutation` (Stryker, hours-long; nightly artifact preferred)                          | `reports/mutation/mutation.json`                                                                |
| lighthouse      | Lighthouse CLI against a preview env (`LIGHTHOUSE_PREVIEW_URL` env var)                        | computed from headless Chrome run; needs an actual deployed URL                                 |
| lint            | `biome check` + `eslint .` (see § *Lint baseline ratchet* above)                                | aggregated in-process                                                                            |

### Detecting an unprimed baseline

Each `*:check` script tells you which side it's on:

- **Unprimed (gate skips, prints a warn):** `[coverage-baseline] baseline
  is unprimed (all workspace rollups are 0); skipping the -2pp gate.`
  / `[bundle-size-baseline] no measurable bundles found (no dist
  output on disk); skipping the gate.`
- **Unprimed (gate fails loud):** `[lighthouse-baseline]
  LIGHTHOUSE_PREVIEW_URL is not set. Configure it on the staging
  GitHub Environment...`
- **Primed (gate is live):** `[coverage-baseline] ok — 6 workspace(s)
  within the -2pp floor` / `[maintainability-baseline] ok —
  rollup['*'].min=81.713 (floor 70, 63 file(s))`

Fail-loud is acceptable — it surfaces the gap on every CI run. Skip-with-warn is the dangerous one: green PR, no protection.

### Mutation — artifact-driven priming

Mutation is the one dimension where running the producer locally is
prohibitively slow (Stryker on the full unit corpus is hours, not
minutes). The nightly `mutation-baseline` job in
[`.github/workflows/nightly.yml`](../.github/workflows/nightly.yml)
already runs Stryker against `main` and uploads
`reports/mutation/mutation.json` + `mutation-check.log` as the
`mutation-baseline` artifact (14-day retention). Prime from that
artifact rather than re-running Stryker locally:

1. Pick the most recent **green** nightly run from
   `gh run list --workflow=nightly.yml --repo dsj1984/athportal` (look
   for `✓ Stryker mutation + per-workspace baseline (unit tier)`).
2. Download the artifact into the report path the consumer reads:
   `gh run download <runId> --repo dsj1984/athportal --name mutation-baseline --dir reports/mutation`.
   This drops `mutation.json` at exactly the path
   `scripts/mutation-baseline.mjs` defaults to
   (`reports/mutation/mutation.json`).
3. Run `pnpm run mutation:update`. The script reads the Stryker JSON,
   rolls up per-workspace killed/survived/noCoverage counts, and
   rewrites `baselines/mutation.json` in place. Byte-stable
   re-emission: re-running against an unchanged report produces an
   identical file.
4. Commit `baselines/mutation.json` + the test-assertion update that
   pins the primed shape (see
   [`scripts/__tests__/mutation-baseline.test.mjs`](../scripts/__tests__/mutation-baseline.test.mjs)
   § *shipped baselines/mutation.json*). The shipped-baseline test
   guards against accidental re-priming to a zero envelope by asserting
   `rollup['*'].killed > 0` and at least one non-zero per-workspace
   score.
5. Confirm `pnpm run mutation:check` reports
   `[mutation-baseline] ok - N workspace(s) within the 5% relative band`
   against the same report — the gate is now live with a 5%
   relative-pct floor on per-workspace `score`
   (`higher-is-better`).

### Mutation — harness fallback (`@repo/baselines`)

`scripts/mutation-baseline.mjs` consumes `@repo/baselines` for byte-stable
JSON serialisation and tolerance evaluation. The harness package's
`exports.import` points at `./src/index.ts`, which a TS-aware loader
(Vitest, the workspace consumer's transpile chain) resolves cleanly but
a plain Node `.mjs` entrypoint cannot. The script wraps the import in a
top-level try/catch (mirroring `scripts/lint-baseline.mjs` lines 64-95)
and ships byte-identical inline implementations of `writeBaseline`
(sorted-key + trailing-LF) and `evaluate` (for the
`relative-pct`/`higher-is-better` shape this dimension uses) so the
production code path is the inline one. When/if a built `.js` surface
lands at `dist/index.js` the harness branch will engage automatically;
no other code in the script needs to change.

## Coverage baseline ratchet

The coverage ratchet keeps per-workspace line / branch / function
coverage **within 2 absolute percentage points of the committed
baseline**. It is a CI gate: a PR cannot drop any workspace's coverage
more than 2pp on any axis without explicitly re-snapshotting the
baseline. The 2pp tolerance is the policy fixed in
[ADR-015](decisions.md) — the script and this runbook move together
with that ADR.

### Files and entrypoints

- [`scripts/coverage-baseline.mjs`](../scripts/coverage-baseline.mjs) —
  the ratchet script. Pure Node ESM, no build step. Reads the
  merged root-level `coverage/coverage-final.json` produced by
  `pnpm run test:coverage` (Vitest's V8 reporter, configured at
  [`vitest.config.ts`](../vitest.config.ts) to write a single artifact
  spanning every workspace's `src/`). The script partitions rows by
  workspace prefix using the list discovered from
  [`pnpm-workspace.yaml`](../pnpm-workspace.yaml), aggregates per-file
  `lines` / `branches` / `functions` percentages, and rolls them up
  into the shared baseline-envelope shape (`$schema`, `kernelVersion`,
  `generatedAt`, `rollup`, `rows`). When the merged artifact is
  absent the script falls back to per-workspace
  `<ws>/coverage/coverage-final.json` files — that path supports
  `pnpm --filter <ws> exec vitest run --coverage` workflows and is
  not exercised in CI. Rollup keys and row paths are sorted
  lexicographically so successive runs against an unchanged tree
  produce byte-identical JSON.
- [`baselines/coverage.json`](../baselines/coverage.json) — the
  committed snapshot. The single source of truth for "how much
  coverage each workspace is required to maintain". Diffs against this
  file are the gate. The shape is fixed by
  [`.agents/schemas/baselines/coverage.schema.json`](../.agents/schemas/baselines/coverage.schema.json)
  via the shared
  [`baseline-envelope.schema.json`](../.agents/schemas/baselines/baseline-envelope.schema.json).
- `pnpm run coverage:check` — runs
  `node scripts/coverage-baseline.mjs --check`. Exits non-zero if any
  workspace dropped more than 2pp on any axis (lines, branches,
  functions). The PR-blocking
  [`coverage-baseline` job in `quality.yml`](../.github/workflows/quality.yml)
  is the CI binding.
- `pnpm run coverage:update` — runs
  `node scripts/coverage-baseline.mjs --update`. Regenerates
  `baselines/coverage.json` from the current tree.

### Refresh procedure

1. **Produce the coverage report.** Run `pnpm run test:coverage`. Root
   Vitest emits a single merged `coverage/coverage-final.json` at the
   repo root covering every workspace's source files. Producer and
   consumer agree on this path — see ADR-015 and Story #384 for the
   alignment history.
2. **Regenerate the baseline.** Run `pnpm run coverage:update`. The
   script reads the merged report, partitions rows by workspace
   prefix, computes the per-workspace rollup, and rewrites
   `baselines/coverage.json` in place. The output is byte-identical
   across runs against an unchanged tree.
3. **Inspect the diff.** Open `baselines/coverage.json` against the
   prior commit. Confirm every per-workspace rollup change is
   justified — a drop is a regression and should not be re-baselined
   without an accompanying source change. A rise is the happy path and
   should be committed so the next contributor cannot quietly
   re-introduce the missing coverage.
4. **Commit the snapshot alongside the source change.** Reviewers
   should see *both* the source change and the baseline bump in the
   same PR. A baseline-only PR is a smell — it means the floor moved
   without a code reason.

### Hand-edit rejection rule

`baselines/coverage.json` is **not** a hand-edited file. Reviewers MUST
reject any PR that hand-edits the snapshot — the only path to update
it is to re-run `pnpm run coverage:update`. This mirrors the
hand-edit rejection rule the other dimension runbooks (lint, CRAP,
maintainability, mutation, lighthouse, bundle-size) enforce.

The script's serialiser sorts keys at every depth and appends a
trailing newline so byte-identical re-emission is the invariant —
any commit that drifts the file off that shape is by definition a
hand-edit and must be reverted.

### Runbook

1. **You ran `pnpm run coverage:check` and it failed.** Read the
   stderr listing — it names the workspace, the axis (lines / branches
   / functions), the prior percentage, the current percentage, and the
   pp delta. The fix-first path is to add tests for the under-covered
   code paths the V8 reporter highlights (open
   `<workspace>/coverage/index.html` to see which files dropped).
2. **The drop is intentional** (e.g. you deleted a feature and its
   tests went with it, lowering the workspace's denominator). Re-run
   `pnpm run coverage:update`, inspect the diff on
   `baselines/coverage.json` to confirm it matches the change you
   expect, and commit the snapshot alongside the source change.
3. **A newly-registered workspace under `apps/*` or `packages/*`.**
   The ratchet treats a new workspace as a pass on the first check
   (no prior rollup to compare against). Run
   `pnpm run coverage:update` to prime the workspace; the next
   `--check` enforces the floor.
4. **Baseline is unprimed** (every per-workspace rollup is `0`). The
   ratchet skips the gate and prints a hint that the operator must
   run `pnpm run coverage:update` once to establish the floor. This is
   the state the freshly-committed
   [`baselines/coverage.json`](../baselines/coverage.json) ships in;
   the first `--update` after this Story merges primes the real
   measurements.
5. **Editor noise / local-only failures.** The ratchet consumes the
   same merged `coverage/coverage-final.json` Vitest produces, so a
   `--check` failure that does not reproduce after
   `pnpm run test:coverage` is a stale coverage report — delete the
   root `coverage/` directory (and any per-workspace `coverage/`
   left over from `pnpm --filter <ws> exec vitest run --coverage`
   runs) and rerun.

## CRAP baseline ratchet

The CRAP ratchet keeps every method's CRAP score **within 5% of its
committed baseline value**. CRAP is `c² · (1 − cov)³ + c` where `c` is
cyclomatic complexity and `cov` is the method's coverage ratio — a
method that gets more branches without compensating coverage rises
quickly, so the per-method ratchet catches "complexity grew, tests
didn't" without a flat cap that would penalize disciplined complex
code. It is a CI gate: a PR cannot raise any method's CRAP score by
more than 5% without explicitly re-snapshotting the baseline. The 5%
relative tolerance is the policy fixed in
[ADR-018](decisions.md) — the script and this runbook move together
with that ADR.

### Files and entrypoints

- [`scripts/crap-baseline.mjs`](../scripts/crap-baseline.mjs) — the
  ratchet script. Pure Node ESM, no build step. Walks every JS/TS
  source under `apps/*` and `packages/*` (skipping tests, fixtures,
  build output, and ambient types), scores per-method CRAP via
  [`typhonjs-escomplex`](https://github.com/typhonjs-node-escomplex/typhonjs-escomplex),
  and rolls the per-row scores into the shared baseline-envelope shape
  (`$schema`, `kernelVersion`, `generatedAt`, `rollup`, `rows`). Rows
  are canonically sorted by `(path, startLine, method)` so successive
  runs against an unchanged tree produce byte-identical JSON.
- [`baselines/crap.json`](../baselines/crap.json) — the committed
  snapshot. The single source of truth for "what CRAP score each
  method is allowed to carry". Diffs against this file are the gate.
  The shape is fixed by
  [`.agents/schemas/baselines/crap.schema.json`](../.agents/schemas/baselines/crap.schema.json)
  via the shared
  [`baseline-envelope.schema.json`](../.agents/schemas/baselines/baseline-envelope.schema.json).
- `pnpm run crap:check` — runs
  `node scripts/crap-baseline.mjs --check`. Exits non-zero if any
  method's CRAP score rose more than 5% above the prior baseline
  value. The PR-blocking
  [`crap-baseline` job in `quality.yml`](../.github/workflows/quality.yml)
  is the CI binding.
- `pnpm run crap:update` — runs
  `node scripts/crap-baseline.mjs --update`. Regenerates
  `baselines/crap.json` from the current tree.

### Refresh procedure

1. **Inspect the failure.** Run `pnpm run crap:check` and read the
   stderr listing — it names every regressed method by
   `path:startLine:method`, prints the prior and current CRAP scores,
   and names the relative-5% tolerance the violation tripped.
2. **Fix-first path.** The expected response to a regression is to
   reduce the method's complexity (extract helpers, collapse branches)
   or, when the coverage cross-link Epic lands, raise its statement
   coverage. The script does not auto-suggest a remediation — the
   reviewer is responsible for confirming the source change matches
   the score movement.
3. **Regenerate the baseline.** When the rise is intentional and
   approved, run `pnpm run crap:update`. The script re-scans the tree,
   recomputes per-method scores, and rewrites `baselines/crap.json` in
   place. The output is byte-identical across runs against an
   unchanged tree.
4. **Inspect the diff.** Open `baselines/crap.json` against the prior
   commit. Confirm every per-row movement is justified — a rise is a
   regression and should not be re-baselined without an accompanying
   source change. A drop is the happy path and should be committed so
   the next contributor cannot quietly re-introduce the complexity.
5. **Commit the snapshot alongside the source change.** Reviewers
   should see *both* the source change and the baseline bump in the
   same PR. A baseline-only PR is a smell — it means the floor moved
   without a code reason.

### Hand-edit rejection rule

`baselines/crap.json` is **not** a hand-edited file. Reviewers MUST
reject any PR that hand-edits the snapshot — the only path to update
it is to re-run `pnpm run crap:update`. This mirrors the hand-edit
rejection rule the other dimension runbooks (lint, coverage,
maintainability, mutation, lighthouse, bundle-size) enforce.

The script's serialiser sorts keys at every depth, sorts rows by
`(path, startLine, method)`, and appends a trailing newline so
byte-identical re-emission is the invariant — any commit that drifts
the file off that shape is by definition a hand-edit and must be
reverted.

### Runbook

1. **You ran `pnpm run crap:check` and it failed.** Read the stderr
   listing — it names every regressed method, the prior score, the
   current score, and the relative-5% policy that fired. The fix-first
   path is to refactor the method (extract helpers, collapse branches)
   so the score returns at or below the prior value.
2. **The rise is intentional** (e.g. a new feature that legitimately
   added branches and you accept the higher CRAP for now). Re-run
   `pnpm run crap:update`, inspect the diff on `baselines/crap.json`
   to confirm only the methods you expected to change actually
   changed, and commit the snapshot alongside the source change.
3. **A newly-added method.** The ratchet treats a new row (one whose
   `path:startLine:method` identifier was absent from the prior
   baseline) as a fresh registration. The harness's `relative-pct`
   evaluator on a `lower-is-better` axis treats `prev = 0` plus any
   `next > 0` as a fail, so a freshly-added method with non-zero CRAP
   *does* fire the gate. Run `pnpm run crap:update` to register the
   new method's baseline value alongside its introducing source
   change.
4. **A method moved (refactor changed its `startLine`).** The row
   identifier embeds the start line, so a moved method appears as a
   new row (with `prev = 0`) and the old row drops out. The new row
   triggers the new-row case above. Run `pnpm run crap:update` in the
   same PR as the move so reviewers see both halves of the rename.
5. **Baseline is unprimed** (empty rows + zero rollup). The ratchet
   skips the gate and prints a hint that the operator must run
   `pnpm run crap:update` once to establish the floor. This is the
   state the freshly-committed
   [`baselines/crap.json`](../baselines/crap.json) ships in; the
   first `--update` after this Story merges primes the real
   measurements.
6. **Parse failure on a source file.** The kernel returns an empty
   row list for any file `typhonjs-escomplex` cannot parse, treating
   it as unscorable rather than zero-complexity. If `crap:update`
   reports fewer rows than expected, run the script with
   `--scan-root=<workspace>` against a single workspace to narrow the
   set, then inspect the offending file manually — the underlying
   parser supports TypeScript via the babel-parser, so a persistent
   parse failure usually indicates a syntactic experiment that
   should not be on the main branch.

## Maintainability baseline ratchet

The maintainability ratchet keeps the **whole-repo `rollup['*'].min`
Maintainability Index (MI) at or above 70** — the mandrel framework's
default floor for the dimension. MI is a 0–171 scale (higher is better)
derived from Halstead volume, cyclomatic complexity, and SLOC; a file
that dips below 70 is the canonical "this module needs to be split or
simplified" signal. It is a CI gate: a PR cannot lower the whole-repo
min below 70 without explicitly re-snapshotting the baseline alongside
a source change that justifies the dip. The floor is policy fixed in
[ADR-019](decisions.md) — the script and this runbook move together
with that ADR.

### Files and entrypoints

- [`scripts/maintainability-baseline.mjs`](../scripts/maintainability-baseline.mjs)
  — the ratchet script. Pure Node ESM, no build step. Walks every JS/TS
  source under `apps/*` and `packages/*` (skipping tests, fixtures,
  build output, and ambient types), scores per-file MI via
  [`typhonjs-escomplex`](https://github.com/typhonjs-node-escomplex/typhonjs-escomplex),
  and rolls the per-row scores into the shared baseline-envelope shape
  (`$schema`, `kernelVersion`, `generatedAt`, `rollup`, `rows`). Rows
  are canonically sorted by `path` so successive runs against an
  unchanged tree produce byte-identical JSON. Per-component rollup
  keys auto-populate for each `apps/<name>` and `packages/<name>`
  workspace discovered in the rows; the `*` key is the whole-repo
  rollup and is the axis the gate enforces.
- [`baselines/maintainability.json`](../baselines/maintainability.json)
  — the committed snapshot. The shape is fixed by
  [`.agents/schemas/baselines/maintainability.schema.json`](../.agents/schemas/baselines/maintainability.schema.json)
  via the shared
  [`baseline-envelope.schema.json`](../.agents/schemas/baselines/baseline-envelope.schema.json).
  Per-row entries carry `{ path, mi }`; the rollup carries
  `{ min, p50, p95 }` on every component key.
- `pnpm run maintainability:check` — runs
  `node scripts/maintainability-baseline.mjs --check`. Exits non-zero
  when `rollup['*'].min < 70`. The failure log names the file dragging
  the whole-repo min down so the fix lands on the responsible source.
  The PR-blocking
  [`maintainability-baseline` job in `quality.yml`](../.github/workflows/quality.yml)
  is the CI binding.
- `pnpm run maintainability:update` — runs
  `node scripts/maintainability-baseline.mjs --update`. Regenerates
  `baselines/maintainability.json` from the current tree.

### Refresh procedure

1. **Inspect the failure.** Run `pnpm run maintainability:check` and
   read the stderr listing — it names the current
   `rollup['*'].min`, the configured floor (70), and the worst file
   whose MI matches the min. That file is the one to fix first.
2. **Fix-first path.** The expected response to a sub-floor min is to
   raise the worst file's MI: split a long module, extract a helper,
   collapse deeply-nested branches, or — when the file is structurally
   sound but Halstead volume is dragging the score — reduce the number
   of distinct operators / operands by removing redundant constants
   and centralising shared imports.
3. **Regenerate the baseline.** When a dip is intentional and approved
   (e.g. a new domain module that will be polished in a follow-up
   Story but currently sits below 70 with a documented plan), run
   `pnpm run maintainability:update`. The script re-scans the tree,
   recomputes per-file MI, and rewrites `baselines/maintainability.json`
   in place. The output is byte-identical across runs against an
   unchanged tree. Note: regenerating the baseline does **not** lower
   the floor — the 70 floor lives in ADR-019, not in the snapshot. A
   refreshed baseline with a min below 70 still fails `:check`. The
   refresh is appropriate only when the source change has lifted the
   min back to or above the floor.
4. **Inspect the diff.** Open `baselines/maintainability.json` against
   the prior commit. Confirm every per-row movement is justified — a
   dip is a regression and should not be re-baselined without an
   accompanying source change. A rise is the happy path and should be
   committed so the next contributor cannot quietly re-introduce the
   complexity.
5. **Commit the snapshot alongside the source change.** Reviewers
   should see *both* the source change and the baseline refresh in
   the same PR. A baseline-only PR is a smell — it means the floor's
   inputs moved without a code reason.

### Hand-edit rejection rule

`baselines/maintainability.json` is **not** a hand-edited file.
Reviewers MUST reject any PR that hand-edits the snapshot — the only
path to update it is to re-run `pnpm run maintainability:update`. This
mirrors the hand-edit rejection rule the other dimension runbooks
(lint, coverage, CRAP, mutation, lighthouse, bundle-size) enforce.

The script's serialiser sorts keys at every depth, sorts rows by
`path`, and appends a trailing newline so byte-identical re-emission
is the invariant — any commit that drifts the file off that shape is
by definition a hand-edit and must be reverted.

### Runbook

1. **You ran `pnpm run maintainability:check` and it failed.** Read
   the stderr listing — it names the current `rollup['*'].min`, the
   floor (70), and the worst file whose MI matches the min. The
   fix-first path is to refactor that file (split modules, extract
   helpers, collapse branches) until its MI clears the floor.
2. **The min sits at or just above 70 on `main`.** That is not a
   failure — it is the gate working. A PR that drops the min by even
   one point fails `:check` until the source dip is addressed. Keep
   the headroom: if the project's worst file scores 75 today, the
   next refactor target should aim to lift it to 80, not park new
   complexity at 71.
3. **A newly-added file scores below 70.** The gate fails on the
   first `:check` run that sees the new file. Either raise the MI
   before merging (split / extract) or — if the file is justified at
   its current shape — accept that the gate will block the PR until
   the source change lifts the min. The ADR-019 floor is the policy
   anchor; refreshing the baseline does not relax it.
4. **Baseline is unprimed** (empty rows + zero rollup). The ratchet
   skips the gate and prints a hint that the operator must run
   `pnpm run maintainability:update` once to establish the rollup.
   This is the state the freshly-committed
   [`baselines/maintainability.json`](../baselines/maintainability.json)
   ships in; the first `--update` after this Story merges primes
   the real measurements.
5. **Parse failure on a source file.** The kernel returns `null` for
   any file `typhonjs-escomplex` cannot parse, treating it as
   unscorable rather than zero-MI. Unscorable files are excluded
   from the envelope entirely (a zero would be a phantom floor
   violation no source change can fix). If `maintainability:update`
   reports fewer rows than expected, run the script with
   `--scan-root=<workspace>` against a single workspace to narrow
   the set, then inspect the offending file manually — the
   underlying parser supports TypeScript via the babel-parser, so a
   persistent parse failure usually indicates a syntactic experiment
   that should not be on the main branch.

## Bundle-size baseline ratchet

The bundle-size ratchet enforces two distinct contracts on every
PR:

1. **Per-bundle compressed budgets** declared in `.size-limit.json`
   (one entry per shipped bundle). A `gzippedKb` measurement that
   exceeds its budget fails the gate.
2. **The non-negotiable Cloudflare Workers 1 MiB compressed cap.**
   The Worker bundle is `apps/api worker` by convention. The script
   warns at 90% of the cap and fails at 100%, regardless of the
   per-bundle budget. Approaching the cap is a Worker-split
   planning trigger — not a budget bump.

Both contracts are policy-anchored in [ADR-014](decisions.md). The
gate is *regression-first, bump-last*: the lowest-friction reaction
to a failing `:check` is to revert the size delta (strip a
dependency, lazy-load the surface, route-split onto an off-critical
path), not to bump the budget. Bumping is the **last** lever, and
when used it requires a paired changelog entry on the same
`.size-limit.json` bundle row.

### Files and entrypoints

- [`scripts/bundle-size-baseline.mjs`](../scripts/bundle-size-baseline.mjs)
  — the ratchet script. Pure Node ESM, no build step. Reads
  `.size-limit.json`, measures `gzipSync` against each bundle's
  `path` on disk, rolls the per-row sizes into the shared baseline-
  envelope shape, and either `:check`s the current measurements
  against budgets and the 1 MiB Worker cap, or `:update`s
  `baselines/bundle-size.json` from the current tree.
- [`.size-limit.json`](../.size-limit.json) — the per-bundle budget
  - changelog file. One entry per shipped bundle:

  ```json
  {
    "name": "apps/api worker",
    "path": "apps/api/dist/worker.js",
    "gzippedKb": 320,
    "rationale": "initial baseline; matches MVP route surface",
    "lastRevised": "2026-05-17",
    "approvedBy": "@dsj1984"
  }
  ```

  `name` is the row key in `baselines/bundle-size.json`. `path` is
  the file (or glob) measured. `gzippedKb` is the budget enforced.
  `rationale`, `lastRevised`, and `approvedBy` are the per-bundle
  changelog fields ADR-014 requires when bumping `gzippedKb`
  upward — the `rationale` field is the changelog itself, not
  decoration.

- [`baselines/bundle-size.json`](../baselines/bundle-size.json) —
  the committed snapshot. Shape fixed by
  [`.agents/schemas/baselines/bundle-size.schema.json`](../.agents/schemas/baselines/bundle-size.schema.json)
  via the shared
  [`baseline-envelope.schema.json`](../.agents/schemas/baselines/baseline-envelope.schema.json).
  Per-row entries carry `{ bundle, rawKb, gzippedKb }`; the
  whole-repo `*` rollup carries `{ totalKb, gzippedKb }`. Rows
  sorted by `bundle` so re-emission is byte-identical.
- `pnpm run bundle-size:check` — runs
  `node scripts/bundle-size-baseline.mjs --check`. Exits non-zero
  on (a) Worker compressed > 1 MiB, (b) any bundle over its budget,
  or (c) a budget bump unaccompanied by a `rationale`/`lastRevised`
  update. The PR-blocking
  [`bundle-size-baseline` job in `quality.yml`](../.github/workflows/quality.yml)
  is the CI binding; it depends on the `build` job so the wrangler
  dist output is on disk before measurement.
- `pnpm run bundle-size:update` — runs
  `node scripts/bundle-size-baseline.mjs --update`. Regenerates
  `baselines/bundle-size.json` from the current tree.

### Revision procedure (regression-first, bump-last)

ADR-014 defines a strict ordering for responding to a failing
`bundle-size:check`. Reviewers MUST walk the steps in order.

1. **Read the failure log.** The script names the failing bundle,
   its declared budget, and the current measured `gzippedKb`. The
   Worker cap failure carries the rejection string
   `Worker 1 MiB cap exceeded` so it is easy to grep for in CI
   logs.
2. **Regression-first.** Default assumption: an overrun is a
   regression. Identify what landed in the same PR that pushed the
   bundle over — a new dependency, an inlined large constant, a
   route surface that pulled in a previously tree-shaken module.
   Remove or defer the size delta:
   - Strip the dependency (use a lighter alternative, write a
     micro-helper, drop the feature).
   - Lazy-load the surface (dynamic `import()`, route-level code
     split).
   - Move the code off the critical path (Worker → background
     job, web island → user-triggered surface).
3. **Bump-last.** Only when the size delta is *justified* —
   typically a deliberate dependency upgrade or a planned feature
   that genuinely needs the bytes — is the budget itself the right
   lever. Bumping is governed by ADR-014 § Decision:
   1. Update `gzippedKb` on the `.size-limit.json` bundle row.
   2. Update `rationale` on the same row to name the dependency
      or feature that justifies the new headroom. The field is the
      per-bundle changelog; reviewers MUST be able to read the
      file and reconstruct *why* the budget moved over its
      lifetime.
   3. Update `lastRevised` to the current ISO date.
   4. Update `approvedBy` (optional but recommended) to the
      reviewer or operator handle who signed off on the bump.
   5. If the bump exceeds **+25% of the previous limit**, the
      `rationale` MUST also name the alternative considered and
      why it was rejected (per ADR-014). This is a code-review
      enforcement, not a script check — the script guarantees the
      `rationale` field is present, not that its content is
      exhaustive.
4. **Worker cap is special.** The 1 MiB Cloudflare compressed cap
   does **not** participate in the bump procedure. Approaching the
   cap (warn threshold = 90%) triggers a planning Story for a
   Worker split — break the Worker into smaller deployments, move
   non-hot routes onto a separate Worker, or split the API surface
   across Workers per domain. **Never** bump past the cap by
   editing `.size-limit.json`; the script ignores per-bundle
   budgets for the Worker row when the cap is breached.
5. **Refresh the baseline.** After landing the source change (or
   the bump-with-rationale), run `pnpm run bundle-size:update`.
   The script re-measures, rewrites `baselines/bundle-size.json`,
   and the next `:check` against an unchanged tree is byte-
   identical. Commit the refreshed baseline alongside the source
   change — a baseline-only PR is a smell.

### Worked examples

**Legitimate dependency-upgrade bump (accepted).** An Epic upgrades
the API's auth library from `lucia@2` to a v3 release whose
bundle ships an extra 4 KiB gzipped of compatibility shims. The
operator:

- Lands the upgrade and runs `pnpm run bundle-size:check`. It
  fails: `apps/api worker: 322.10 KiB gzipped (budget 320.00 KiB,
  Δ=+2.10 KiB)`.
- Verifies the increase is genuine (tree-shaking confirmed; no
  duplicate copies on the dep graph).
- Edits `.size-limit.json`:
  - `gzippedKb` raised from `320` to `325` (5 KiB headroom for
    future minor revisions of the same dep — keeps successive
    `lucia` patch releases off the gate).
  - `rationale` updated: `"lucia v3 compatibility shims add ~4 KiB
    gzipped vs v2; tree-shaking verified; alternative considered:
    pin to v2 — rejected because v2 ships no security patches
    after 2026-04"`.
  - `lastRevised` updated to today's date.
- Runs `pnpm run bundle-size:update` and commits both files in the
  same PR. The script accepts the bump because both `rationale`
  and `lastRevised` are present and updated on the same row.

**Accidental regression bump (rejected).** A PR raises
`gzippedKb` from `320` to `350` on `.size-limit.json` to clear a
red CI step but does **not** update `rationale` or `lastRevised`.

- `pnpm run bundle-size:check` fails with
  `[bundle-size-baseline] ❌ bundle budget raised without paired
  rationale update — apps/api worker: budget 320.00 → 350.00 KiB
  (missing 'rationale' and 'lastRevised')`.
- The script refuses the bump even though `350 KiB < 1024 KiB`
  (well under the Worker cap). The rationale-paired check is the
  per-bundle changelog enforcement; ADR-014 treats an unpaired
  bump as silently raising the regression bar over time.
- Remediation: revert the budget change, do the work to drop the
  size delta, and either land the source fix (no `.size-limit.json`
  change needed) or land a real bump-with-rationale per the
  worked example above.

### Hand-edit rejection rule

`baselines/bundle-size.json` is **not** a hand-edited file.
Reviewers MUST reject any PR that hand-edits the snapshot — the
only path to update it is to re-run
`pnpm run bundle-size:update`. The script's serialiser sorts
keys, sorts rows by `bundle`, and emits a trailing newline so
byte-identical re-emission is the invariant.

`.size-limit.json`, by contrast, **is** a hand-edited file — it is
the per-bundle budget + changelog source of truth. The script
guarantees the file is valid JSON shaped as an array; reviewers
guarantee the `rationale` content is meaningful and the bump
ordering (ADR-014) was respected.

### Runbook

1. **You ran `pnpm run bundle-size:check` and it failed.** Read
   the stderr listing — the rejection string names whether the
   failure was the 1 MiB Worker cap, a per-bundle budget, or an
   unpaired bump. Walk the revision procedure above starting at
   step 2.
2. **The Worker is at 90%+ of the cap (warning only).** Plan a
   Worker-split Story now — do not wait for the next dep upgrade
   to push the build over the cliff. The warning is the script
   telling you the buffer is gone.
3. **A new bundle was added to `.size-limit.json`.** The first
   `:check` against a newly-declared bundle has no prior baseline
   row to compare against; the rationale-paired check skips it.
   Run `pnpm run bundle-size:update` to prime the row.
4. **A bundle file does not exist on disk yet** (pre-build state,
   as `apps/api` sits today before the wrangler build target
   lands). The script gracefully no-ops the missing row — the
   gate stays a pass and emits a stdout hint to run
   `pnpm run build && pnpm run bundle-size:update` once the build
   target lands. This is the state the freshly-committed
   [`baselines/bundle-size.json`](../baselines/bundle-size.json)
   ships in.
5. **`baselines/bundle-size.json` diverges from current
   measurements but `:check` passes.** That is fine — the
   baseline file is informational on the read side. The gate is
   keyed off `.size-limit.json` budgets, not off baseline drift.
   Run `pnpm run bundle-size:update` to refresh the snapshot when
   you want the committed file to reflect current reality.

## Local quality gate (`quality:ci-local`)

`pnpm run quality:ci-local` is the **local mirror** of the
`.github/workflows/quality.yml` GitHub Actions workflow. It chains the
same five steps the CI job runs, in the same order, failing fast on the
first non-zero exit:

```sh
pnpm run lint \
  && pnpm run typecheck \
  && pnpm run test \
  && pnpm run build \
  && pnpm run lint:baseline:check
```

Use it before pushing to pre-validate a branch against the gate that
will run in CI. A clean exit locally is a strong (but not absolute —
CI runs on a fresh checkout with `--frozen-lockfile`) predictor that
the PR's `quality` check will pass.

### Why a separate script from `quality:preview`?

`quality:preview` is the **operator-facing diff-narrowed convenience**
described above — it delegates to
`.agents/scripts/quality-preview.js --changed-since HEAD` and only
inspects files touched on the working branch. Its job is fast feedback
during iteration, not parity with CI.

`quality:ci-local` is the **CI parity script**. It runs the whole-tree
gates `quality.yml` runs and is intentionally slower. The two scripts
coexist: iterate with `quality:preview`, then run `quality:ci-local`
before push to catch anything the diff-narrowed view missed.

## Supply-chain CVE remediation via `pnpm.overrides` {#pnpm-overrides-remediation-pattern}

When `scripts/audit-check.mjs` blocks on a High or Critical advisory in a
transitive dependency, the remediation hierarchy is fixed by
[ADR-011](decisions.md#adr-011--supply-chain-cve-gate-is-a-required-check):
**lift the floor of the vulnerable package via `pnpm.overrides`** when an
upstream patched version exists. The allow-list (`IGNORED` map in
`scripts/audit-check.mjs`) is the fallback for the rare advisory with no
upstream patch and a documented unreachability argument — not the default
lever.

> **Reviewer rejection criterion.** Allow-list-first solutions when an
> upstream patch exists are rejected. The PR must add a `pnpm.overrides`
> entry pinning the patched floor; an `IGNORED` entry alongside an
> available patch is a review block, not a discussion.

### Four-step walkthrough

The worked example below uses a placeholder advisory ID
(`GHSA-xxxx-xxxx-xxxx`) and a hypothetical transitive dependency
(`vulnerable-pkg`). Substitute the real values from `pnpm audit --json`
output and the GitHub advisory page when remediating an actual finding.

#### 1. `audit-check` fails

`pnpm run audit:check` (CI's `supply-chain-security` job, mirrored
locally) exits non-zero with a blocking finding:

```text
BLOCKING High/Critical advisories (1):
  - GHSA-xxxx-xxxx-xxxx (vulnerable-pkg) severity=high
    Prototype pollution in vulnerable-pkg <1.4.2
    https://github.com/advisories/GHSA-xxxx-xxxx-xxxx

Remediate via `pnpm.overrides` in package.json (preferred per ADR-011) or,
when no upstream patch exists and a documented unreachability argument
applies, add an IGNORED entry with `reason` + future `revisit` date.
```

#### 2. Identify the upstream patched version

Open the advisory page (`https://github.com/advisories/GHSA-xxxx-xxxx-xxxx`)
and read the **Patched versions** field. If a fixed release exists (for
this example, `>=1.4.2`), continue to step 3 — overrides are the correct
lever. If no patch exists, the allow-list path applies; document the
unreachability argument in an `IGNORED` entry per ADR-011 and stop here.

Confirm the patched version range is compatible with the project's
declared range for that dependency (or any first-party consumers). A
floor bump that breaks a peer-dep constraint requires a coordinated
upgrade, not an override.

#### 3. Add the `overrides` entry

Edit the root `package.json` and add the override under the top-level
`pnpm.overrides` key. The version specifier pins the **minimum** patched
floor — pnpm resolves the highest version in the range that satisfies all
consumers, so a `>=` specifier is preferred over a pinned exact version
unless a known regression rules out a later release.

```jsonc
{
  "name": "athportal",
  "private": true,
  "pnpm": {
    "overrides": {
      // GHSA-xxxx-xxxx-xxxx — prototype pollution in vulnerable-pkg <1.4.2
      "vulnerable-pkg": ">=1.4.2"
    }
  }
}
```

#### 4. Pair the override with the audit-finding ID

Every `pnpm.overrides` entry MUST carry a paired comment naming the
advisory ID that justifies the pin. Without the comment, the override
reads as a stylistic preference and the next reviewer cannot tell whether
removing it is safe. The comment is the hygiene artifact ADR-011 calls
out — `git blame` on the line lands on the PR that introduced the
finding, and the GHSA URL is one click away.

Comment placement: directly above the override entry, inside the
`pnpm.overrides` block, in the format
`// GHSA-xxxx-xxxx-xxxx — <short advisory title>`. JSONC tolerates
single-line comments inside `package.json` for pnpm-managed workspaces;
if the file is strict JSON, move the same metadata into an adjacent
`docs/decisions.md` entry that the override references by commit SHA.

After saving, re-run `pnpm install` to refresh the lockfile and
`pnpm run audit:check` to confirm the finding clears. Commit the
`package.json` change, the lockfile update, and (if applicable) any
documentation cross-reference in a single commit so reviewers see the
override and the cleared advisory together.

## Authenticated test sessions (Clerk test instance)

Acceptance suites that need to drive a protected route sign in once per
persona by calling the canonical
[`@clerk/testing/playwright`](https://clerk.com/docs/testing/playwright/overview)
helper from the seam at
[`packages/shared/src/testing/auth.ts`](../packages/shared/src/testing/auth.ts).
The seam targets a **Clerk test instance** — never the production
instance — and is consumed by the `signInAs({ page, persona })` fixture
plus the canonical Gherkin step
`Given I am signed in as {string}`. There is no dev-only auth bypass;
sign-in drives the real Clerk client SDK against a real Clerk test
instance per the security baseline
([`.agents/rules/security-baseline.md`](../.agents/rules/security-baseline.md)).

### Seeded Clerk test users

Four user accounts live on the Clerk **test instance** (operator-owned —
created via the Clerk dashboard, not via this repo). Each maps to a
persona consumed by the test-auth seam:

| Persona     | Seeded email             | Role         | Org / Team scope          |
| ----------- | ------------------------ | ------------ | ------------------------- |
| `athlete`   | `athlete@example.com`    | `member`     | —                         |
| `coach`     | `coach@example.com`      | `team_admin` | seed org A, seed team A-1 |
| `org admin` | `org-admin@example.com`  | `org_admin`  | seed org A                |
| `dev admin` | `dev-admin@example.com`  | `dev_admin`  | —                         |

These email addresses use the `@example.com` synthetic domain reserved
by [RFC 2606](https://datatracker.ietf.org/doc/html/rfc2606) for
documentation and testing. Clerk's email validator rejects the `.invalid`
TLD, so the persona fixtures and the contract-tier synthetic-PII guard
([`packages/shared/src/testing/safety.ts`](../packages/shared/src/testing/safety.ts))
— which still pins `.invalid` for DB seeds — intentionally diverge: the
persona table is the only place `@example.com` is accepted, and the
synthetic-PII guard remains the gate for everything that touches the DB.

The persona labels (`'athlete'`, `'coach'`, `'org admin'`, `'dev admin'`)
are the exact strings the Gherkin step `Given I am signed in as {string}`
accepts.

### Required env vars

Three operator-owned env vars drive the seam:

| Env var                       | Purpose                                                                                                                                                                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `CLERK_SECRET_KEY`            | Test-instance secret key. Consumed by `@clerk/testing/playwright`'s `clerkSetup()`.                                                                                                                                       |
| `CLERK_TEST_USER_PASSWORD`    | Single shared password used by all four seeded users. Consumed by `signInAs(...)`.                                                                                                                                        |
| `CLERK_TEST_PERSONAS_READY`   | Opt-in flag (`'1'`) that arms the per-persona Playwright projects and the global-setup storage mint. Stays unset until the persona-specific protected web surfaces tracked by [Issue #383](https://github.com/dsj1984/athportal/issues/383) land. |

`CLERK_SECRET_KEY` and `CLERK_TEST_USER_PASSWORD` are **only valid on
the test instance** — leaking them cannot compromise production users.
They are stored in GitHub Secrets and in each contributor's local
`.env`; only placeholders ship in
[`.env.example`](../.env.example). `CLERK_TEST_PERSONAS_READY` is a
plain config flag — it carries no secret material and lives in the
workflow's `env:` block (or a contributor's `.env`) directly.

The previous Clerk testing-token signing key (`CLERK_TESTING_TOKEN_SIGNING_KEY`)
is no longer used — testing tokens are minted server-side by Clerk
using `CLERK_SECRET_KEY`, and the dashboard-exported "signing key"
concept never existed in Clerk's product.

### Operator runbook — seeding the test users

One-time setup per Clerk test instance:

1. **Switch to the test instance.** Sign in to the Clerk dashboard and
   confirm the instance picker shows the test/development instance
   (never production).
2. **Create the four users.** Under **Users → Create user**, add each
   row from the table above. Email-verify each entry; the test instance
   auto-verifies in most projects.
3. **Set a shared password.** Generate one strong random password
   (≥20 characters, mixed case + digits + symbols, no ambiguous
   characters like `0` / `O` / `1` / `l`) and use it as the password
   for all four users.
4. **Publish secrets.** Add `CLERK_TEST_USER_PASSWORD` (the same shared
   password) and `CLERK_SECRET_KEY` (the test-instance secret key from
   the dashboard's API keys page) to the repo's GitHub Actions secrets.
5. **Populate local `.env`.** Each contributor pastes the same two
   values into their gitignored `.env`. Never commit the real
   values — `.env.example` carries placeholders only.

### Rotation runbook

Rotate quarterly or immediately on suspected exposure:

1. **Rotate the password in Clerk.** For each seeded user, generate a
   new shared password and update all four user records in the Clerk
   dashboard. (To rotate `CLERK_SECRET_KEY`, generate a new secret key
   under **API Keys → Standard** on the test instance and revoke the
   previous one.)
2. **Refresh GitHub Secrets.** Update `CLERK_TEST_USER_PASSWORD` (and
   `CLERK_SECRET_KEY` if rotated) under the repo's Actions secrets.
   The acceptance workflow
   ([`.github/workflows/quality.yml`](../.github/workflows/quality.yml))
   reads them at job start; no workflow edit is required.
3. **Bump the local `.env`.** Every engineer refreshes the matching
   line in their gitignored `.env`.
4. **Re-run the acceptance smoke locally.** Run
   `pnpm --filter @repo/web exec bddgen && pnpm --filter @repo/web test:e2e -- --grep @smoke`
   to confirm the per-persona `storageState` cache regenerates against
   the new credentials. Stale cache files under
   `apps/web/playwright-output/storage/` are safe to delete — the
   fixture re-creates them on the next run.
5. **Confirm CI is green.** Push a no-op commit (or re-run the latest
   CI job) and verify the `acceptance-smoke` job passes before closing
   the rotation ticket.

## Protecting an API route

Every protected route under `/api/v1/*` runs through the two-stage
middleware chain in
[`apps/api/src/middleware/auth.ts`](../apps/api/src/middleware/auth.ts).
The composition is mounted once at the app boundary; individual routes
inherit it.

```ts
// apps/api/src/index.ts (composition root — pattern shown for reference)
import { Hono } from 'hono';
import { clerkAuth, requireInternalUser } from './middleware/auth';

const app = new Hono();

// Stage 1 — every request: validate the Clerk session token.
//   - Reads __session cookie or Authorization: Bearer …
//   - Verifies against CLERK_SECRET_KEY via @clerk/backend.
//   - On failure: 401 { success: false, error: { code: 'UNAUTHENTICATED', … } }
//   - On success: writes c.var.clerkSubjectId.
app.use('*', clerkAuth());

// Stage 2 — protected surface: JIT-provision the internal users row.
//   - Fast path: SELECT users WHERE clerk_subject_id = :sub.
//   - Miss: INSERT … ON CONFLICT DO NOTHING RETURNING *  → re-SELECT on conflict.
//   - On success: writes c.var.auth (AuthContext) for downstream handlers.
app.use('/api/v1/*', requireInternalUser());

// Route handlers read c.var.auth and pass (role, resource, action) into
// canPerform() from @repo/shared/rbac before any state change.
app.get('/api/v1/me', (c) => {
  const { userId, email, role } = c.var.auth;
  return c.json({ success: true, data: { id: userId, email, role } });
});
```

Authorization is a **separate concern** from authentication. Inside a
route handler, after the auth middleware has populated `c.var.auth`,
call `canPerform(role, resource, action, ctx)` from
[`packages/shared/src/rbac/policy.ts`](../packages/shared/src/rbac/policy.ts)
to gate any state mutation. The policy is exhaustively unit-tested
across `(role, resource, action)` triples — never re-derive authorization
logic inline in a route.

Mounting rules:

- `clerkAuth()` MUST mount before `requireInternalUser()`. The second
  middleware reads `c.var.clerkSubjectId`; without the first stage it
  has nothing to look up and defensively returns 401.
- Public routes (e.g. health, OAuth callbacks) MUST be defined **before**
  the `app.use('*', clerkAuth())` line, or carry an explicit
  authentication bypass per the security baseline. Today the only
  unauthenticated surface is the health endpoint at `/api/v1/health` —
  expand the list deliberately, never accidentally.
- Stack traces and internal error details MUST NOT be returned to the
  caller. The middleware emits only the canonical `UNAUTHENTICATED`
  envelope; route handlers do the same for their own failure codes
  (`FORBIDDEN`, `NOT_FOUND`, etc.).

Constraints from `AGENTS.md` §Safety Constraints and the architecture
doc apply to this file: `apps/api/src/middleware/auth.ts` is
security-critical and changes require explicit review.

## Writing an authenticated test

Test-tier choices for an authenticated surface:

| What you are testing | Tier | Tooling |
| --- | --- | --- |
| Pure logic the route depends on (e.g. RBAC policy) | Unit | Vitest, no `createTestApp` |
| Route returns the right wire shape / status / DB row for a given persona | Contract | `createTestApp(db, { actor })` |
| User journeys end-to-end (sign-in redirects, banners, role-gated UI) | Acceptance | Playwright + `Given I am signed in as {string}` |

### Contract tier — `createTestApp(db, { actor })`

The two-argument form of `createTestApp` from
[`packages/shared/src/testing/app.ts`](../packages/shared/src/testing/app.ts)
swaps **only** the JWT-validation stage. The downstream
`requireInternalUser` middleware runs unchanged from production — the
test exercises the real JIT lookup, real `AuthContext` composition, and
real route handler.

```ts
// apps/api/src/routes/v1/<resource>/__tests__/patch.contract.test.ts
import { type AuthContext, createTestApp, freshDb } from '@repo/shared/testing';
import { users } from '@repo/shared/db/schema';
import { requireInternalUser } from '../../../middleware/auth';
import { resourceRoute } from '../resource';

const coach: AuthContext = {
  userId: 'u_coach_1',
  clerkSubjectId: 'user_test_coach',
  email: 'coach@test.invalid',
  role: 'team_admin',
  orgId: 'org_test_a',
  teamId: 'team_test_a_1',
};

it('lets a team_admin update their own team resource', async () => {
  // Arrange — seed the users row so requireInternalUser's fast-path hits.
  const db = await freshDb();
  await db.insert(users).values({
    id: coach.userId,
    clerkSubjectId: coach.clerkSubjectId,
    email: coach.email,
    role: coach.role,
    orgId: coach.orgId,
    teamId: coach.teamId,
  }).run();

  const app = createTestApp(db, { actor: coach })
    .use('/api/v1/*', requireInternalUser())
    .route('/api/v1', resourceRoute);

  // Act
  const res = await app.request('/api/v1/resources/r_1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Renamed' }),
  });

  // Assert — wire shape + DB side-effect.
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ success: true, data: { name: 'Renamed' } });
});
```

For 401 / anonymous-path tests, use the **single-argument** form
(`createTestApp(db)`) — no actor is bound, `c.var.auth` is undefined,
and any handler that reads it surfaces the same `UNAUTHENTICATED`
envelope production emits. See
[`apps/api/src/routes/v1/me.actor.contract.test.ts`](../apps/api/src/routes/v1/me.actor.contract.test.ts)
for the reference test that pins this contract across the four MVP
personas.

### Acceptance tier — `Given I am signed in as {persona}`

Acceptance scenarios sign in once per persona via the canonical Gherkin
step defined in
[`apps/web/e2e/steps/auth.steps.ts`](../apps/web/e2e/steps/auth.steps.ts):

```gherkin
@identity::coach @domain::roster
Feature: Coach invites an athlete

  Scenario: The athlete appears on the roster once they accept
    Given I am signed in as "coach"
    When I invite an athlete by email and they accept the invitation
    Then I see the athlete listed on my team roster
```

The accepted persona labels are `'athlete'`, `'coach'`, `'org admin'`,
`'dev admin'`, and `'anonymous'`. Under the hood the step calls
`resolvePersona(label)` and `signInAs({ page, persona })` from the seam
at
[`packages/shared/src/testing/auth.ts`](../packages/shared/src/testing/auth.ts),
which drives `@clerk/testing/playwright`'s `clerk.signIn` against the
Clerk test instance using the seeded persona's email and the shared
`CLERK_TEST_USER_PASSWORD`. Clerk plants the session cookies on the
Playwright context; the per-persona Playwright projects persist that
context via `storageState` so subsequent scenarios resume the session
without re-signing-in. There is no dev-only auth bypass; an unknown
label throws a `TypeError` listing the accepted spellings.

Scenario authoring constraints (cross-cutting with
[`docs/testing-strategy.md` § Forbidden Patterns](testing-strategy.md#forbidden-patterns)):

- Acceptance scenarios assert **user-visible outcomes only**. HTTP
  status codes, JSON shapes, and DB row state belong in the matching
  contract test, not in the `.feature` file.
- Do not author a near-match for `Given I am signed in as {string}`.
  Reuse the canonical phrase verbatim; widen the persona table via a
  follow-up Story if a new role is genuinely needed.
- The test-user password and test-instance secret key follow the
  rotation runbook in
  [§ *Authenticated test sessions (Clerk test instance)*](#authenticated-test-sessions-clerk-test-instance)
  above.

## How to add a new step

The acceptance tier reads from a small, deliberately constrained step
vocabulary. Adding a new step is a cost — it fragments the phrase library
and can hide a near-miss reuse. Follow this runbook so the vocabulary
stays disciplined and the linter stays green.

### Where steps live

The five canonical step files live under
[`apps/web/e2e/steps/`](../apps/web/e2e/steps/):

- `auth.steps.ts` — sign-in, sign-out, role/identity setup.
- `form.steps.ts` — text entry, form submission, file uploads.
- `navigation.steps.ts` — page navigation, URL transitions.
- `rbac.steps.ts` — user-visible authorization outcomes.
- `visibility.steps.ts` — assertions about banners, lists, rows, and
  other on-screen artefacts.

Per-domain step files (one per feature area) sit alongside these
canonical files when a domain accrues enough scenarios to justify its
own bucket. Cross-cutting phrases stay in the canonical five.

### Process

1. **Grep the step library first.** Search the existing
   `apps/web/e2e/steps/*.ts` for the phrase you want. If it exists, reuse
   it verbatim and rephrase the scenario to fit. If a near-match exists,
   widen the parameter (swap a literal for `{string}`) and update every
   call site in the same PR.
2. **Pick the right file.** Keep concerns co-located — auth in
   `auth.steps.ts`, visibility in `visibility.steps.ts`, and so on.
   Cross-cutting phrases that do not fit a canonical file usually mean
   the scenario is asserting an implementation detail; reshape the
   scenario instead of adding a new file.
3. **Honour the tier boundaries.** A step body asserts **user-visible
   outcomes only**. HTTP status codes, DB row state, JSON shapes, and
   raw SQL belong in contract tests — see
   [`docs/testing-strategy.md`](testing-strategy.md) and the
   [assertion-placement rule](../.agents/rules/testing-standards.md#assertion-placement).
4. **Reference the new step from a scenario in the same PR.** Unused
   steps are warnings during development and become errors at Epic close
   (enforced by [`scripts/lint-steps.mjs`](../scripts/lint-steps.mjs)).
5. **Run the linter locally.** `pnpm run lint:steps` runs the same three
   rule classes CI runs (no duplicate phrases, no forbidden patterns, no
   unused steps at Epic close). The Husky `pre-commit` hook also runs
   `pnpm run lint:steps --staged` against staged changes; do not bypass
   it with `--no-verify`.

### Gherkin authoring rules

Phrasing and tag conventions for `.feature` files themselves live in
[`.agents/rules/gherkin-standards.md`](../.agents/rules/gherkin-standards.md).
Read that rule before authoring a new scenario — it covers the canonical
tag taxonomy, the Background discipline, and the forbidden patterns the
linter enforces.

## Local development orchestrator

A single `pnpm dev` from the repo root brings up the api and web
workspaces together:

```bash
pnpm dev
```

The script chains two stages:

1. **`scripts/dev-preflight.mjs`** — verifies that `.env` exists at the
   repo root, that the required env vars are populated
   (`CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`,
   `PUBLIC_CLERK_PUBLISHABLE_KEY`, `PUBLIC_API_URL`, `DATABASE_URL`),
   and that the local SQLite file exists. If `packages/shared/data/local.db`
   is missing, the script creates the parent directory and applies every
   migration under `packages/shared/src/db/migrations/` in order. The
   step exits non-zero with a punch list when any prerequisite is
   missing — there are no silent fallbacks.
2. **`turbo run dev --parallel`** — fans out to `@repo/api`
   (`tsx watch src/local.ts`, listens on `http://localhost:8787` via
   [`@hono/node-server`](https://github.com/honojs/node-server)) and
   `@repo/web` (`astro dev`, listens on the Astro default port).

The api uses Node + `better-sqlite3` for local dev because the Workers
V8 isolate cannot load native bindings. The Workers entrypoint that
ships with Epic #27 will reuse the same `app` from
[`apps/api/src/index.ts`](../apps/api/src/index.ts) but construct
`c.env.DB` from `@libsql/client` instead — the contract surface
(`c.var.db` set by `withDb()`) stays the same across hosts.

### Env contract enforced by the preflight

| Var | Required by | Notes |
|---|---|---|
| `CLERK_SECRET_KEY` | api | Backend session validation. |
| `CLERK_PUBLISHABLE_KEY` | api | Issuer derivation for authorized-party checks. |
| `PUBLIC_CLERK_PUBLISHABLE_KEY` | web | Frontend Clerk init. |
| `PUBLIC_API_URL` | web | Defaults to `http://localhost:8787` per `.env.example`. |
| `DATABASE_URL` | api | Must use the `file:` scheme for local dev (e.g. `file:packages/shared/data/local.db`). `libsql://…` is rejected at preflight — that scheme lands with Epic #27. |
| `CLERK_WEBHOOK_SECRET` | api | Optional locally; only needed to exercise the invitation-accepted webhook. |

The preflight loads `.env` itself; the spawned api process re-loads it
from [`apps/api/src/local.ts`](../apps/api/src/local.ts) because
turbo's child processes do not inherit env mutations from the
orchestrator. `apps/web/.env` is loaded by Astro per its usual
convention.

Story #760 wired this orchestrator. Before it, the api had no `dev`
script and no runtime DB binding — every admin route under
`/api/v1/admin/*` would crash on the first `c.var.db` access if hit by
a real client. Tests passed because they injected the handle via
`createTestApp(db)`; the production composition is now equivalent.
