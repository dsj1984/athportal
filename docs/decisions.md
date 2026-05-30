# Architecture Decision Records (ADRs)

> **Seed set carried forward from the legacy athlete-portal repo.** Each ADR below was load-bearing for MVP scope and is being re-ratified in athportal so `/epic-plan` has anchors to design against. New ADRs accumulate from ADR-016 onward as Epics close.
>
> Original Epic / Story / Sprint numbers from the legacy repo have been stripped — they refer to a different project's history. The *rationale* and *consequences* are what carries forward.

---

## ADR-001 — Query module pattern for API layer decoupling

**Status**: Accepted

**Context**: Inline Drizzle ORM query logic scattered across Hono route handlers creates deep coupling between HTTP concerns and database access, makes handlers hard to unit-test in isolation, and produces duplicated query fragments across routes.

**Decision**:

- Introduce a `src/queries/` directory in `@repo/api` with one file per domain (e.g. `teams.queries.ts`, `users.queries.ts`, `events.queries.ts`).
- Each query module exports typed async functions that accept a `db` instance and return typed results. **No Drizzle query-builder code lives outside these modules.**
- Route handlers import from `src/queries/` and are forbidden from constructing Drizzle queries directly.

**Consequences**:

- Query functions are individually unit-testable against an in-memory SQLite instance without spinning up a Hono server.
- New developers have a single discoverable location for all database-access patterns.
- Query reuse across routes is explicit rather than copy-pasted.

---

## ADR-002 — Centralized error handling via `withErrorHandler` middleware

**Status**: Accepted

**Context**: Without a central handler, every route grows its own try/catch block and error response shapes drift — some return `{ error: string }`, others `{ message: string }`, some leak raw exception messages to the client.

**Decision**:

- Introduce a `withErrorHandler(handler)` utility in `apps/api/src/lib/errors.ts` that wraps any Hono route handler in a standardized try/catch.
- All caught errors are mapped to the canonical `{ success: false, error: { code, message } }` shape defined in `@repo/shared/schemas`.
- Complement with `findOrFail(queryFn)` (throws typed 404) and `requireOwnership(record, userId)` (throws typed 403) to eliminate the most common inline guard patterns.

**Consequences**:

- Error response shape is guaranteed consistent across all routes — the contract every contract test asserts against.
- Route-handler code is leaner (the happy path only).
- `findOrFail` and `requireOwnership` are reusable across all domains without per-handler boilerplate.

---

## ADR-003 — Shared UI component library in `@repo/web`

**Status**: Accepted

**Context**: Ad-hoc inline implementations of common UI states (loading spinners, empty-state placeholders, user avatars) proliferate across feature components if unmanaged — identical JSX duplicated across dozens of files with inconsistent accessibility attributes and styling.

**Decision**:

- Create a `src/components/ui/` directory in `@repo/web` housing reusable primitives (`LoadingSpinner.tsx`, `EmptyState.tsx`, `Avatar.tsx`, etc.).
- Each component exports a typed props interface and follows the project accessibility baseline (WCAG 2.1 AA).
- Feature components import from `@/components/ui/`. Inline re-implementations are deleted.

**Consequences**:

- Single implementation to maintain and accessibility-audit.
- Consistent visual behaviour across all surfaces.
- Props interfaces are exported, enabling consumers to extend or compose without guessing the API.

---

## ADR-004 — Test data factory pattern with typed builders

**Status**: Accepted

**Context**: Test files constructing raw database records inline using `{ id: 'test-1', name: 'Test User', ... }` literals are brittle (schema changes require hunting down every test), incomplete (missing required fields silently default to `undefined`), and inconsistently shaped across the suite.

**Decision**:

- Introduce a test data factory in `packages/shared/src/testing/factories/` that exports a typed builder for each major entity (`buildUser`, `buildTeam`, `buildEvent`, …).
- Each builder accepts a partial override object and merges it with safe, realistic defaults. Defaults are derived from the Zod schema to stay in sync with validation rules.
- All API and shared unit/contract tests that construct test records use these builders exclusively.

**Consequences**:

- Schema changes require updating one factory function rather than dozens of test files.
- Test intent is clearer — overrides express only the data relevant to the specific scenario.
- Factories serve as living documentation of the minimum valid shape for each entity.

---

## ADR-005 — JIT user provisioning + mandatory onboarding gate

**Status**: Accepted

**Context**: New users synced from Clerk can hit authenticated API endpoints before the `user.created` webhook finishes writing the corresponding row into `users`, producing spurious 401s and empty dashboards. Inferring "needs onboarding" from sentinel values (`first_name === 'Unknown'`, `dob IS NULL`) and a dismissible client-side modal lets users close the flow without completing it.

**Decision**:

- Add a dedicated `onboarded_at` (`TEXT`, nullable, ISO 8601) column to `users` as the single source of truth for onboarding completion.
- `requireInternalUser` middleware (`apps/api/src/middleware/auth.ts`) performs a **Just-In-Time** upsert: if no row exists for the verified Clerk ID, insert a placeholder row inline and continue the request. This decouples the app from Clerk webhook latency.
- Enforce onboarding server-side via Astro SSR middleware (`apps/web/src/middleware.ts`). Authenticated users whose `onboarded_at` is `NULL` are redirected to `/onboarding` with HTTP 307, except on `/onboarding` itself, `/api/*`, and asset routes.
- Replace any dismissible modal with a dedicated full-page route (`/onboarding`) that submits to `POST /api/v1/auth/onboard`. The endpoint validates the payload with `OnboardUserInputSchema` (Zod) and stamps `onboarded_at`.

**Consequences**:

- The Clerk webhook is no longer on the critical path for user creation; webhook race conditions are eliminated.
- Onboarding cannot be skipped from the client — the gate is enforced by server middleware.
- Every authenticated user is guaranteed to have either a fully-onboarded row or a placeholder row awaiting onboarding — no 404/401 "user not found" state remains.

---

## ADR-006 — Soft delete + bcrypt share passwords

**Status**: Accepted

**Context**: User-visible content (highlights, comments, posts) needs full lifecycle management. Hard deletes break referential integrity for mentions, likes, and downstream analytics. Storing share passwords requires a trust model that never exposes plaintext even to operators with DB access.

**Decision**:

- Use **soft deletes** uniformly on user-visible content via a nullable `deleted_at` (ISO 8601) column. All read queries filter `deleted_at IS NULL`; cascade-deletion of child rows on parent delete is a write-time responsibility of the query module.
- Store share passwords as **bcrypt hashes** (cost factor ≥12 per the security baseline) in dedicated `*_password_hash` columns. The API hashes on write with `bcrypt.hash` and verifies on the unlock endpoint with `bcrypt.compare`. Plaintext passwords are never persisted and never echoed in responses.
- For idempotent toggle actions (likes, bookmarks), model them as join tables with unique composite indexes rather than denormalized counters on the parent row — keeps the write path idempotent and avoids lock contention.

**Consequences**:

- Recovery of accidentally deleted content is a data-layer decision rather than a customer-support escalation — any retention job can reinstate rows by clearing `deleted_at`.
- Analytics queries must explicitly filter `WHERE deleted_at IS NULL` or they will double-count deleted rows.
- Share password rotation is a single `PATCH` — the old hash is overwritten; passing `null` clears it (public link).

---

## ADR-007 — File-upload content type validated from bytes, not headers

**Status**: Accepted

**Context**: The client-supplied `Content-Type` header on a multipart part is trivially spoofed (an attacker can upload an SVG or HTML file labelled `image/png` and serve XSS to every viewer). A malformed image of the wrong dimensions also degrades the surface that renders it.

**Decision**:

- Upload endpoints **ignore the multipart `Content-Type` header entirely.** The handler reads the file bytes, sniffs the magic-number signature, and accepts only the explicitly-allowed MIME types. Anything else is rejected with `error.code = INVALID_FILE_TYPE`.
- Byte-size and dimension caps are enforced server-side before the asset is persisted. Failures return `FILE_TOO_LARGE` or `IMAGE_TOO_SMALL` so the client can render a precise message.
- Only upload endpoints may write asset URL columns (`cover_photo_url`, `avatar_url`, etc.). Profile/entity `PATCH` routes strip those fields if present, removing the URL-string surface from the trust boundary.

**Consequences**:

- Spoofed-MIME XSS via any upload surface is not reachable from a normal upload.
- Client-side validation is a UX optimization only — the server is the source of truth.
- Any color/CSS values accepted from users (e.g. branding colors) are regex-validated before being injected as CSS custom properties, closing the matching style-injection vector.

---

## ADR-008 — Slug-first public discovery surface

**Status**: Accepted

**Context**: Discoverable entities (organizations, teams, events, tournaments) need stable, human-readable URLs for anonymous read access by search engines and share links. They cannot be addressable only by opaque UUIDs gated behind authentication.

**Decision**:

- Add `slug` (unique, kebab-case, generated by a shared `slugify` util in `@repo/shared`) and `isPublic` (boolean, default `false`) columns to every publicly-discoverable entity.
- Introduce a `publicRead` middleware in `apps/api` that opens specific GET routes to anonymous callers and applies an **IP-keyed token-bucket rate limit** (separate from the authenticated quota).
- Public detail pages resolve by slug first, falling back to ID for back-compat. Slug routes are canonical; ID routes 301-redirect to the slug variant when a slug is present.
- Private entities (`isPublic = false`) are filtered at the **query layer**, not the response layer, so they never appear in any anonymous list response or sitemap.
- Slug uniqueness is enforced at the DB level; the slugify util appends a numeric suffix on collision so authors are not blocked at write time.

**Consequences**:

- Search engines can index public pages; structured-data and OG/Twitter card emitters standardize the per-page head.
- Anonymous abuse surface is bounded by the IP rate limiter — exceeding the bucket returns `429` with `RATE_LIMITED`.

---

## ADR-009 — Adopt BDD/Gherkin acceptance layer + three-tier testing pyramid

**Status**: Accepted

**Context**: Without a canonical document telling authors where a given assertion belongs, "where do I put this test?" consumes review cycles and produces flaky, overlapping coverage. The submodule-tracked `.agents/rules/testing-standards.md` defines a three-tier pyramid (unit, contract, acceptance) and a bidirectional placement rule; the project needs a project-level companion that maps those generic rules onto concrete tools and workspaces.

**Decision**:

- Adopt a three-tier pyramid — **unit** (Vitest, pure logic, colocated), **contract** (Vitest + ephemeral SQLite, `*.contract.test.ts`, wire shape + DB side-effects), **acceptance** (Playwright-bdd with `.feature` files; Detox binder at v1.0) — as the canonical testing model.
- Codify the **assertion-placement rule**: HTTP status codes, wire shapes, error envelopes, and DB-state assertions live **only** at the contract tier. User-visible outcomes live **only** at the acceptance tier. Pure logic lives **only** at the unit tier. Duplicated assertions across tiers are review blockers.
- Publish [`docs/testing-strategy.md`](./testing-strategy.md) as the project-level single source of truth and point `AGENTS.md`, `CLAUDE.md`, and `docs/patterns.md` at it rather than duplicating rules.
- Reserve `.spec.ts` exclusively for Playwright acceptance specs; Vitest suites use `.test.ts` / `.test.tsx`.
- Provide a shared contract-test harness in `@repo/shared/src/testing/` (`freshDb()` / `createTestApp()` / `seedUser()`) so contract tests never hand-roll DB bootstraps.

**Consequences**:

- Authors pick a tier deterministically by the class of assertion — review cycles stop re-litigating placement.
- RBAC correctness is covered exhaustively at the unit tier (every `(role, resource, action)` triple) and re-enforced at the contract tier on real routes.

---

## ADR-010 — Detox is the mobile acceptance runner (v1.0)

**Status**: Accepted (forward-looking; activates with the v1.0 native-apps Epic)

**Context**: When mobile native apps ship at v1.0, the BDD acceptance runner must bind the shared `tests/features/**` Gherkin corpus to a mobile step library so cross-platform scenarios execute on iOS and Android without duplicating authoring. The two candidates evaluated in the legacy project were Detox and Maestro.

**Decision**:

- **Adopt Detox** as the mobile acceptance runner. Bindings live at `apps/mobile/e2e/steps/**`; the binder that converts `tests/features/**` into Jest+Detox tests lives at `apps/mobile/e2e/bind-features.mjs`.
- **Mirror the web runner's step-library organization** in Detox (`auth.steps.ts`, `navigation.steps.ts`, `form.steps.ts`, `visibility.steps.ts`, `rbac.steps.ts`, …). New cross-platform step phrases land on both platforms in the same change.
- **Extend `scripts/lint-steps.mjs`** to cover both `apps/web/e2e/steps/**` and `apps/mobile/e2e/steps/**` with the same forbidden-pattern list — one linter, one vocabulary contract.
- **Cross-runner parity** is enforced by `scripts/check-step-parity.mjs`: a cross-platform scenario phrase bound on only one side fails the build.
- **Maestro** may be retained for single-flow mobile smoke checks that don't need step-library parity, but does not execute any `.feature` scenario.

**Rejected — Maestro as primary runner**: Maestro flows are YAML, not TypeScript; there is no analogue to a step-definition file. Adding a new cross-platform phrase requires editing an adapter script rather than a `.steps.ts` file beside its web twin, and the forbidden-pattern linter cannot be applied to YAML without parallel maintenance.

**Consequences**:

- Step-library and linter parity is structural, not aspirational.
- Tag-filtered project matrix (`smoke` / `risk-high` / `nightly` / `default`) carries over from web to mobile unchanged.
- A Cucumber-compatible report from Detox+Jest keeps downstream report ingestion (`/sprint-testing`) working without a new format.

---

## ADR-011 — Supply-chain CVE gate is a required check

**Status**: Accepted

**Context**: The security baseline requires `pnpm audit` to run before every release. Without a required CI gate, that rule is unenforced — a reachable High/Critical advisory can land on `main` silently.

**Decision**:

- **Promote a `supply-chain-security` job to a required check** on `main`. `build-and-e2e` (and any mobile equivalents) list it in `needs:` so a failed audit blocks the deploy-targeted pipeline.
- **Block on High and Critical advisories.** A `scripts/audit-check.mjs --level=high --prod` script exits non-zero on any unsuppressed High/Critical advisory in the production graph. Moderate findings surface in the JSON artifact for review but do not block.
- **`pnpm.overrides` is the primary remediation lever.** When a transitive CVE has a patched upstream version, the fix lands as an `overrides` entry in `package.json` — not as a silenced advisory.
- **Allow-list exceptions require a written reason and revisit date.** The `IGNORED` map in `scripts/audit-check.mjs` is the suppression mechanism for the rare advisory with no upstream patch and a documented unreachability argument. Each entry carries a `reason` string and a `revisit` date.
- **Upload `audit.json` as a 14-day artifact** so reviewers can triage Moderate findings without re-running the audit locally.

**Consequences**:

- `main` cannot ship a new reachable High/Critical advisory without an explicit suppression.
- Override entries become a hygiene artifact — each pinning a security floor has a paired audit-finding ID.

---

## ADR-012 — Observability vendor stack (MVP beta)

**Status**: Accepted

**Context**: The MVP beta needs the minimum viable production stack to leave a black-box state: error tracking across runtimes, structured logs with edge-side PII redaction, latency/error dashboards on top-N routes, external uptime probes, and an alert path that reaches the operator.

**Decision**:

- **Sentry** is the error-tracking vendor across `apps/api`, `apps/web`, and (at v1.0) `apps/mobile`. First-party SDKs cover all runtimes (`@sentry/cloudflare`, `@sentry/astro` + `@sentry/react`, later `@sentry/react-native`). Sourcemap upload wired into CI per runtime.
- **Cloudflare Workers Analytics Engine + Logpush** is the structured-log + dashboard surface for `apps/api`. The AE binding (`LOG_AE`) lands one row per request from the request-completion logger middleware; Logpush forwards full structured payloads to a managed sink for retention and search.
- **Better Stack** is the external uptime-probe vendor. Probes MUST be hosted by a vendor independent of Cloudflare so a Cloudflare-side outage cannot silence its own alerts.
- **The alerting channel of record is the operator's email**, paged by Sentry alert rules and Better Stack failure rules into the same inbox. No parallel paging path (SMS, Pushover, PagerDuty) is provisioned for the beta.
- **Cost ceiling: $50/month.** Beta posture lands on free tiers; ceiling is set well above the estimate so a single-month overage doesn't require same-day escalation. Two consecutive months over triggers a renegotiate/downsize follow-on.
- **Migration cost is bounded at one Story per vendor.** No vendor lock-in beyond the SDK surface.

**Rejected — Datadog / Honeycomb unified vendor**: Free tiers too small for a unified observability vendor at beta scale; SDK surface area would be a multi-Story rewrite to swap later.

**Rejected — Cloudflare tail logs only**: Tail logs do not symbolicate stack traces against uploaded sourcemaps; do not cover web SSR errors or mobile JS crashes.

**Consequences**:

- The redaction allowlist at `packages/shared/src/observability/redaction.ts` is the single trust boundary for log egress.
- A synthetic-failure endpoint (gated by env flag) is the operator's validated end-to-end alert path.

---

## ADR-013 — Staging-auto, production-gated deploy promotion

**Status**: Accepted

**Context**: The production deploy pipeline needs (a) staging deploys with no approval friction so every push to `main` rolls forward immediately, (b) production deploys behind a manual-approval gate that cannot be bypassed by accidentally tagging a release or merging a hot-fix, (c) per-environment secret scoping, and (d) a documented rollback procedure with an audit trail.

**Decision**:

- **Two workflows, two environments, two triggers.** `.github/workflows/deploy-staging.yml` is triggered on `push` to `main` and binds every job to `environment: staging`. `.github/workflows/deploy-production.yml` is triggered on `workflow_dispatch` only — no `push` or `schedule` trigger — and binds every job to `environment: production`.
- **GitHub Environments are the safety boundary.** Secrets, approvers, and deploy targets live in the Environment, not on the repo. The production Environment carries a Required-reviewers protection rule with at least one named approver. Nothing in the workflow YAML can bypass it.
- **`scripts/check-env.mjs --deploy --env <name>`** is the per-environment fail-fast. Each deploy workflow runs this as a `validate-*-config` job that every deploy job depends on.
- **Rollback procedure** has two supported paths: (1) re-dispatch `Deploy · Production` with `ref: <previous tag or SHA>` (preferred — full audit trail in GitHub Actions log); (2) `wrangler rollback --env production` (faster, but audit lives only in Cloudflare's deployment history — the runbook records the rationale separately).
- **Audit-trail expectations.** Every production deploy MUST be traceable to (a) workflow run ID, (b) approver's GitHub identity, (c) deployed git ref, (d) Sentry release tag emitted at build time.

**Rejected — single multi-stage pipeline** (`push → staging → wait → production`): Secret blast radius (easy to reference a production secret in a staging step); rollback ergonomics (re-dispatching re-runs both stages); partial-success handling (staging-success / production-denied reports as overall "failed").

**Rejected — push-triggered production with branch protection**: This repo doesn't use PRs; branch-protection-based reviewers don't apply.

**Consequences**:

- A leaked staging credential cannot reach production.
- Production rollback is operator-driven via the production workflow; staging is untouched.

---

## ADR-014 — Bundle-size budget revision procedure

**Status**: Accepted

**Context**: Bundle-size baselines live in `baselines/bundle-size.json` and `.size-limit.json`. Without an ADR, the lowest-friction reaction to a failing build is to bump the budget — that path defeats the gate and silently raises the regression bar over time. Cloudflare Workers also impose a hard 1 MiB compressed upload cap; raising that is not negotiable.

**Decision**:

- **An overrun is a regression to fix by default.** When `pnpm bundle-size:check` fails, the first remediation is to land the change without the size delta (strip a dependency, lazy-load the surface, split into a route off the critical path). Bumping the budget is the **last** lever, not the first.
- **Raising a budget requires a paired `rationale` update in the same change**, naming the dependency or feature that justifies the headroom. Bumps exceeding +25% of the previous limit additionally name the alternative considered and why it was rejected.
- **The Cloudflare 1 MiB compressed Worker cap is non-negotiable.** The script warns at 90% of cap and fails at 100% regardless of per-bundle budget. Approaching the cap triggers a planning Story for a Worker split, not a budget bump.
- **The +10% headroom on initial commit is a one-time grace, not a recurring allowance.** Subsequent revisions are measured against the *previous committed budget*, not the current measurement.
- **Intentional dependency upgrades are budget-bump candidates; accidental regressions are not.**

**Rejected — advisory-only gate**: Audit cost dominates the gate cost; the operator has zero spare attention for quarterly slogs.

**Rejected — auto-bump on first overrun**: Directly subverts the gate's intent — converts it into an audit log no one reads.

**Consequences**:

- The `rationale` field becomes the per-bundle changelog.
- Approaching the 1 MiB cap is a planning trigger, not a budget edit.

---

## ADR-015 — Per-package coverage hard floor with absolute-pp tolerance

**Status**: Accepted

**Context**: Coverage % without a per-package ratchet lets a package decay from 88% to 30% silently while passing every other gate. The seven-baseline quality-ratchet model requires a dedicated coverage floor alongside lint, CRAP, maintainability, mutation, lighthouse, and bundle-size.

**Decision**:

- Adopt a per-workspace coverage baseline at `baselines/coverage.json` gated by `scripts/coverage-baseline.mjs`.
- **Floor per workspace = `current − 2 percentage points`** (absolute, not relative). The check runs in the `test` and `test-mobile` jobs immediately after coverage capture.
- Refresh procedure: run `pnpm test:coverage` → `pnpm coverage:update` (overwrites the baseline file with current values + `generatedAt` timestamp + tolerance metadata) → commit with subject `chore(baseline): refresh coverage baseline (-2pp buffer)`.
- **Never raise a floor without a corresponding test addition.** Refreshing upward should reflect real coverage gain, not noise. If uncertain, run `pnpm test:coverage` twice and take the lower numbers.

**Rejected — relative-% tolerance to match CRAP**: 5% relative would be 4pp at 80% baseline, 4.75pp at 95% baseline. Penalizes high-coverage packages disproportionately, gives low-coverage packages too much rope.

**Rejected — per-metric tolerances (lines vs branches vs functions vs statements)**: Premature complexity. The JSON shape supports it later without breaking the file format.

**Consequences**:

- Coverage drift is visible at CI time, not at quarterly audit.
- The check is per-workspace, not aggregate — a 5pp drop in `@repo/mobile` cannot be hidden by a 5pp gain in `@repo/api`.
- The initial commit ships unprimed (`primed: false`, `null` per-workspace entries). The operator runs `pnpm test:coverage && pnpm coverage:update` once to prime real numbers.

---

## ADR-016 — `/api/v1` route-mount and post-MVP deprecation policy

**Status**: Accepted (2026-05-17, Epic #3)

**Context**: The HTTP API surface needs a single, stable mount point so clients (web, mobile-web PWA, later native mobile) can pin to a versioned base URL without re-discovering route shape on every release. Pre-MVP, the API is still finding its shape — every Epic that lands routes may legitimately need to rename a path, restructure a payload, or remove a field that turned out to be wrong. Post-MVP, the same flexibility is a stability liability: a paying client cannot tolerate a silent breaking change to `GET /api/v1/teams/:id`. The project also needs an explicit answer to "what happens when we *do* need to break a v1 contract after MVP launch?" so the question doesn't get re-litigated per Epic.

**Decision**:

- **All API routes mount under `/api/v1`.** Every router under `apps/api/src/routes/v1/**` composes onto this prefix; no route ships at `/api/<anything-else>` or at the bare `/` path (excepting the health probe `/api/v1/health` and any Cloudflare-required well-known endpoints). The `v1` segment is a literal, not a build-time variable — clients pin to it directly.
- **Pre-MVP, breaking changes inside `/api/v1` are allowed.** Until MVP launch the API has no external paying clients; the cost of a renamed path or restructured payload is bounded to the same-PR client update. Document the breakage in the Epic's PR body and update the matching Zod schema in `@repo/shared` in the same change — `architecture.md` § 5 (Safety Constraints) already requires this pairing.
- **Post-MVP, `/api/v1` is additive-only.** Once MVP ships, `/api/v1` accepts only backwards-compatible changes: new routes, new optional request fields, new response fields. Removing a field, renaming a path, tightening a validator, or changing a status-code semantic is **not** an additive change and **must not** land on `/api/v1`.
- **Breaking changes ship to `/api/v2` with a six-month deprecation overlap.** When a breaking change is genuinely required post-MVP, it lands behind a new `/api/v2` mount. The previous version (`/api/v1`) continues to serve for **six months** from the day `/api/v2` ships its first route in the affected domain. During the overlap, both versions are maintained; after the overlap, the deprecated route on `/api/v1` returns `410 Gone` with an error envelope pointing clients at the `/api/v2` replacement.
- **The six-month clock runs per route, not per version.** Adding a single breaking route under `/api/v2` does not start a deprecation clock on the entire `/api/v1` surface — only on the matching route. Routes that never had a breaking change continue indefinitely under `/api/v1`.

**Rejected — unversioned mount (`/api/*`)**: Forces every breaking change to be either a coordinated client rollout or a silent failure for older clients. No safety margin for slow mobile rollouts.

**Rejected — date-versioned mount (`/api/2026-05`)**: Solves the per-change versioning problem but explodes the URL surface and complicates RPC-client typing against `@repo/api`'s `AppType`. Acceptable for some industries (Stripe) but disproportionate for an athlete-portal scope.

**Rejected — header-based versioning (`Accept: application/vnd.athportal.v2+json`)**: Hides the version from caches, CDN routing rules, log dashboards, and operator-readable URLs. Worse ergonomics for the same correctness guarantees as path-versioned mounts.

**Consequences**:

- The `apps/api/src/routes/v1/**` directory shape is a load-bearing convention — moving a router out of that tree is a breaking change subject to this ADR.
- Foundation Epics that touch the API entrypoint (router composition, OpenAPI emission, Hono RPC client typing) reference this ADR rather than re-deciding the prefix.
- Post-MVP, every Epic that lands routes has a checklist item: "is this additive? if not, does it belong under `/api/v2`?". The answer lives in the Epic PR body.
- The six-month overlap is a **floor**, not a ceiling. Specific routes may be carried longer when client telemetry shows non-trivial residual traffic; shortening below six months requires an ADR superseding this one.
- Cross-references: `docs/architecture.md` § 1 (Tech Stack) names the `/api/v1` mount as the API workspace's entrypoint; this ADR is the authoritative rule it points back to.

---

## 2026-05-17 — `quality` workflow is the canonical PR quality gate

**Status**: Accepted (operational pin, Epic #3)

**Context**: Epic #2 landed the [`quality`](../.github/workflows/quality.yml)
workflow (lint → typecheck → test → build → lint-baseline ratchet) and
wired it into `pull_request` and `push: main`. Epic #3 needs a single
named PR gate to declare "required" on the `main` branch ruleset so the
[branch-protection-setup runbook](./runbooks/branch-protection-setup.md)
has an unambiguous target. Without an explicit pin, future Epics could
introduce parallel quality workflows and the "which checks are
required?" question becomes a recurring review topic.

**Decision**:

- **The `quality` workflow is the canonical PR quality gate.** It is the
  required check listed in
  [`docs/runbooks/branch-protection-setup.md`](./runbooks/branch-protection-setup.md)
  under "Required status checks" for the `main` branch.
- New language-, framework-, or domain-level quality steps land **inside**
  `quality.yml` (as additional steps in the existing job, or as new jobs
  in the same workflow) rather than as parallel workflows. The required
  check name stays `quality` for the lifetime of the project.
- Workflows that are **not** the PR quality gate
  (`migration-label-guard`, `deploy-staging`, `deploy-production`,
  future security/governance hooks) live in their own files and are
  added to the branch-protection rule on their own merits — they do not
  subsume `quality`'s role.
- `pnpm run quality:ci-local` MUST remain a faithful local mirror of
  `quality.yml`'s job chain so contributors can reproduce CI failures
  offline without a push.

**Consequences**:

- The branch-protection ruleset has a stable, named target —
  re-applying it after a fork is mechanical.
- The "which workflow gates the PR?" question has a single answer at any
  point in time, which is what the runbook documents.
- Adding a quality step is a single-file change (`quality.yml`) plus, if
  the step introduces a new failure mode, a paragraph in
  [`docs/patterns.md`](./patterns.md). It is **not** a new required
  check on the ruleset.

---

## ADR-017 — Destructive-migration label, guard workflow, and two-reviewer rule

**Status**: Accepted (2026-05-17, Epic #3)

**Context**: Schema migrations are the highest-risk class of change in
this repo because they cannot be rolled back by
[`wrangler rollback`](./runbooks/branch-protection-setup.md) once the
database has applied them. A `DROP COLUMN`, a `RENAME`, or a
`NOT NULL ADD` against a populated column is a one-way door — a forward
fix requires a fresh migration that re-creates state, which under time
pressure during an incident is the exact wrong shape of work. The same
PR-level gate that catches code regressions (the `quality` workflow)
cannot detect this risk class because it operates on lint/type/test
output, not on a semantic read of the diff. Without an explicit label
and a workflow that requires it, the destructive change ships when the
first reviewer is moving fast and the diff happens to be small.

**Decision**:

- **The `migration::destructive` PR label is the canonical marker for
  destructive schema changes.** Any PR whose diff adds a `DROP`,
  `RENAME`, or `NOT NULL ADD` clause inside a Drizzle migration file
  under `apps/api/**/migrations/**` MUST carry the label. The label is
  created once via the
  [branch-protection setup runbook](./runbooks/branch-protection-setup.md#one-time-label-bootstrap)
  with color `D93F0B` and the description
  `"PR touches a destructive migration (DROP / RENAME / NOT NULL ADD) — second-approver required"`.
- **The `migration-label-guard` workflow enforces the label
  mechanically.** It runs on `pull_request` (opened, synchronize,
  reopened, labeled, unlabeled), reads the PR diff via the GitHub API,
  matches added lines against the three destructive patterns above
  inside the migration path predicate, and fails the check when matches
  are found without the label. When no migration files are touched the
  check passes trivially — this is required because the
  `apps/api/**/migrations/**` directory does not yet exist on every
  branch.
- **The two-reviewer rule is enforced procedurally.** GitHub
  branch-protection's required-approvers count cannot conditionally bump
  for a single label, so the rule is documented in
  [`README.md` § "Destructive migrations"](../README.md#destructive-migrations)
  and lives in the reviewer's discipline: the first reviewer approves on
  general merit and explicitly `@`-mentions a second reviewer; the
  second reviewer's approval is what unlocks the merge. The PR author
  MUST NOT self-merge a `migration::destructive` PR.
- **The label and the guard are paired, not redundant.** The guard
  fails-closed when the label is missing — that is the load-bearing
  mechanical gate. The two-reviewer rule fails-open by design — it
  relies on reviewer attention to honor the convention. Both layers are
  needed: the guard catches "author forgot to label"; the two-reviewer
  rule catches "author labeled correctly but the change still needs
  more eyes".

**Rejected — branch-protection rule with conditional required-approvers
based on label**: GitHub's branch-protection ruleset cannot express
"require 2 approvers when label X is present, 1 otherwise". The closest
analog is a CODEOWNERS escalation, which requires a `CODEOWNERS` file
keyed to migration paths — that approach trades the label visibility (a
red badge in the PR list) for a hidden CODEOWNERS mapping that authors
won't notice until they hit the rule.

**Rejected — pre-commit hook that blocks destructive clauses**: A
local hook fires before the PR exists, can be bypassed with
`--no-verify`, and is not the reviewer-visible signal the label
provides. Hooks complement the workflow at most — they do not replace
it.

**Rejected — workflow that auto-applies the label**: The label is a
declaration of intent ("I know this is destructive and the migration is
necessary"), not a side effect of the diff shape. Auto-applying the
label drops the author's accountability and removes the moment of
deliberation the label is there to create.

**Consequences**:

- The `migration::destructive` label is part of the repo's required-PR
  vocabulary; adding the workflow as a required check on the `main`
  ruleset is the operator's responsibility per the
  [branch-protection setup runbook](./runbooks/branch-protection-setup.md#1-required-status-checks).
- The guard workflow's path predicate (`apps/api/**/migrations/**`) is a
  load-bearing convention. Moving migrations out of that tree without
  updating the workflow defeats the gate silently.
- The guard inspects **added** lines only. A diff that removes a
  destructive clause (reverting a previous migration) does not re-fire
  the guard.
- Cross-references:
  [`README.md` § "Destructive migrations"](../README.md#destructive-migrations)
  (the author-facing rule surface) and
  [`docs/runbooks/branch-protection-setup.md`](./runbooks/branch-protection-setup.md)
  (the operator-facing setup runbook) both point back to this ADR.
  Changes to the policy require superseding this ADR, not editing the
  downstream documents in isolation.

---

## ADR-018 — Per-method CRAP baseline with relative-5% tolerance

**Status**: Accepted (2026-05-17, Epic #6)

**Context**: CRAP (Change Risk Anti-Patterns) is the seventh dimension in the quality-baseline pyramid alongside lint, coverage, maintainability, mutation, lighthouse, and bundle-size. The score is `c² · (1 − cov)³ + c` where `c` is the method's cyclomatic complexity and `cov` is its coverage ratio — high-branch, low-coverage methods rise quickly, low-branch fully-covered methods stay near `c`. The pyramid needs a per-method ratchet that catches "this method got more complex without compensating coverage" without forcing a single absolute integer cap that would penalize legitimate domain code (a 30-branch reducer with thorough tests is healthier than a 5-branch helper with none, and a flat cap conflates the two).

The dimension is per-method (not per-file or per-workspace) because CRAP is a method-level metric and rolling it up to file or workspace granularity erases the signal — a workspace's average CRAP can stay flat while one method's score doubles. The existing six dimensions already prove that per-row ratchets land cleanly on this stack ([`scripts/lint-baseline.mjs`](../scripts/lint-baseline.mjs), [`scripts/coverage-baseline.mjs`](../scripts/coverage-baseline.mjs)), and the shared envelope contract supports a `rows: [{path, method, startLine, crap}]` shape directly.

**Decision**:

- Adopt a per-method CRAP baseline at `baselines/crap.json` gated by the Mandrel framework engine (`node .agents/scripts/check-baselines.js --gate crap`).
- **Tolerance per method = `current ≤ prev × 1.05`** (relative-5%, lower-is-better). A method whose CRAP score rises by 5% or less of the prior baseline value passes; a method whose score rises by more than 5% fails the gate. The relative form scales naturally — a method scoring 4 has a 0.2-point headroom, a method scoring 100 has a 5-point headroom — so the ratchet stays meaningful across the score range.
- **Row identity = `path:method`**. `startLine` is stored per row for source navigation but is not part of the identity key (Story #999 / PR #999). A full method rename or file move is a row rename (the prior row identifier disappears, a new one appears with `prev = 0`); the new row is treated as a fresh registration that does not fire the gate. This matches the harness's "deletions are never regressions" invariant from [Story #210](../packages/baselines/src/compare.ts).
- **Refresh procedure**: run `pnpm run crap:update` (regenerates `baselines/crap.json` from the current tree with `generatedAt` refreshed and rows canonically sorted by `(path, method)`) → inspect the diff → commit with subject `chore(baseline): refresh crap baseline`.
- **Never raise a floor without a corresponding source change.** A row whose CRAP score rises after `:update` is by definition a regression that the source PR should have caught — the only legitimate refresh is one where the source diff justifies every per-row movement.

**Rejected — absolute-integer tolerance (`prev + 3` or similar)**: Penalizes high-CRAP methods proportionally more than low-CRAP ones. A method scoring 4 → 7 is a 75% rise and clearly bad; the same `+3` tolerance lets a method scoring 100 → 103 slide because the relative drift is trivial. Absolute integer policy gets this exactly backwards.

**Rejected — per-file or per-workspace rollup as the gate**: CRAP is a method-level metric. Rolling it up to file or workspace before applying tolerance erases the per-method signal — one method's regression can be hidden by another method's improvement under the same rollup key. The rollup (`rollup."*".p50/p95/max/methodsAbove20`) is informational only; the gate runs per row.

**Rejected — flat absolute cap (e.g. `crap ≤ 20` for every method)**: The cap matches the conventional CRAP refactor threshold and is captured in the rollup's `methodsAbove20` axis for visibility, but using it as the gate would block legitimate complex code that has invested in coverage. Methods above 20 are surfaced via the rollup; they are not auto-failed.

**Consequences**:

- CRAP regressions are visible at CI time, not at quarterly audit. The `crap-baseline` job in [`.github/workflows/quality.yml`](../.github/workflows/quality.yml) is the binding gate.
- The script's `:update` path is the only writer of `baselines/crap.json`. Hand-edits are rejected by reviewers and would be caught at the next `:update` because the canonical row order and the stable JSON serialisation produce byte-identical output across runs.
- The baseline was primed with real measurements in Story #375 and converged onto the Mandrel framework engine in Story #1000. `baselines/crap.json` ships pre-populated on `main`; `pnpm run crap:check` is live from the next commit.
- Coverage integration is deferred. The current scoring requires per-method V8 coverage to compute a full CRAP score; methods without a matching V8 declaration are excluded from the baseline entirely (rather than defaulting to `cov = 0`). When the coverage cross-link Epic lands, the match rate will increase and the baseline row count will grow to approach the full method population.
- Cross-references: [`docs/patterns.md` § "CRAP baseline ratchet"](./patterns.md#crap-baseline-ratchet) is the operator-facing refresh runbook; the [Epic #6 Tech Spec](https://github.com/dsj1984/athportal/issues/196) carries the schema and harness rationale.

---

## ADR-019 — Maintainability Index baseline with rollup `*` min floor of 70

**Status**: Accepted (2026-05-17, Epic #6)

**Context**: Maintainability Index (MI) is the fourth dimension in the quality-baseline pyramid alongside lint, coverage, CRAP, mutation, lighthouse, and bundle-size. MI is a 0–171 composite score (higher is better) derived from Halstead volume, cyclomatic complexity, and SLOC — a file that combines high token diversity, dense branching, and length scores low. The dimension complements CRAP (which is method-level and catches "complexity rose without coverage") by acting at the file level and catching "this module is structurally hard to read regardless of whether the branches are tested". Without an explicit floor, MI is observable but not actionable — a file can decay from 95 to 45 silently while every other gate stays green.

The mandrel framework default for this dimension targets the rollup `min` axis with a floor of 70, not a per-row `mi` tolerance: a single file dragging the whole-repo min below 70 is the canonical "this module needs to be split or simplified" signal, while files above the floor have already paid their structural-hygiene cost. Per-row tolerance is also possible — the harness supports it via `compareWithTolerance(..., { axes: ['mi'] })` — but a per-row ratchet would either be too tight (every refactor that touches a borderline file would re-baseline) or too loose (a 5% relative tolerance on a file scoring 100 allows a five-point drop, which on a 0–171 scale is meaningful drift). The rollup `min` floor sidesteps both failure modes by anchoring the gate to the project's worst-scoring file regardless of how the per-row values churn.

**Decision**:

- Adopt a per-file MI baseline at `baselines/maintainability.json` gated by the Mandrel framework engine (`node .agents/scripts/check-baselines.js --gate maintainability`).
- **The gate is `rollup['*'].min >= 70`** (the mandrel framework default). A `:check` run that finds the whole-repo min below 70 fails non-zero and the stderr log names the file whose MI matches the min — the file dragging the gate down. Per-row `mi` values are recorded and surfaced via the per-component rollups (`apps/<name>`, `packages/<name>`) for visibility, but **only the rollup `*` `min` axis fires the gate**.
- **The floor lives in ADR-019, not in the baseline file.** `:update` regenerates the snapshot from the current tree; it does not lower the floor. A refreshed `baselines/maintainability.json` whose `rollup['*'].min` is below 70 still fails `:check`. Moving the floor requires a new ADR superseding this one — the baseline file is a measurement, not a policy.
- **Row identity is `path`**. A file move (rename across directories) is a row rename (the prior `path` disappears, a new one appears); the new row carries whatever MI the file scores in its new location. The harness's "deletions are never regressions" invariant from [Story #210](../packages/baselines/src/compare.ts) applies but is incidental — the gate runs against the rollup, not against per-row drift.
- **Per-component rollups auto-populate.** Every `apps/<name>` and `packages/<name>` workspace that contains at least one scorable source file gets its own rollup key with the same `{ min, p50, p95 }` shape as `*`. This makes per-workspace dashboards possible without a separate emission path; the per-component keys are informational today but provide the surface a future per-workspace floor could target without a schema change.
- **Refresh procedure**: run `pnpm run maintainability:update` (regenerates `baselines/maintainability.json` from the current tree with `generatedAt` refreshed and rows canonically sorted by `path`) → inspect the diff → commit with subject `chore(baseline): refresh maintainability baseline`.
- **Never raise a snapshot without a corresponding source change.** A refreshed snapshot whose `rollup['*'].min` rose reflects real complexity reduction and is the happy path. A refreshed snapshot whose min dropped is by definition a regression that the source PR should have addressed — the only legitimate refresh is one where the source diff justifies every per-row movement.

**Rejected — per-row `mi` tolerance (relative-pct or absolute-pp)**: Too tight at 5%/2pp on disciplined files (every refactor of a borderline file re-baselines), too loose on long modules (a 5pp drop from MI=100 to MI=95 is a meaningful structural regression but slides under any per-row gate). The rollup `min` floor avoids both failure modes by anchoring to the worst file rather than chasing per-row drift.

**Rejected — per-workspace floor with different thresholds per workspace**: Premature complexity. The per-component rollups are already emitted so a future ADR can layer per-workspace floors without re-shaping the schema or the script. Until the project surfaces a workspace whose structural shape demands a different floor, one project-wide policy is simpler and reviewable.

**Rejected — module-level MI from the `worstMethod` field** (per-method MI): MI is canonically a module-level metric; rolling up per-method MI to the file level erases the signal the file-level MI carries (Halstead volume across the whole module, not a worst-method outlier). CRAP is the per-method dimension; MI is the per-file companion. The two dimensions are complementary, not redundant.

**Consequences**:

- Maintainability regressions are visible at CI time, not at quarterly audit. The `maintainability-baseline` job in [`.github/workflows/quality.yml`](../.github/workflows/quality.yml) is the binding gate.
- The script's `:update` path is the only writer of `baselines/maintainability.json`. Hand-edits are rejected by reviewers and would be caught at the next `:update` because the canonical row order and the stable JSON serialisation produce byte-identical output across runs.
- The initial commit ships unprimed (empty rows, zero rollup) per the ADR-015 and ADR-018 precedents; the operator runs `pnpm run maintainability:update` once after this Epic merges to prime real measurements. Until the prime, the script's `:check` mode emits a skip-the-gate message — the unprimed envelope is the green light by design.
- The 70 floor is a **policy floor**, not a calibration floor. Future kernel changes (e.g. a different MI variant, a different parser) bump `kernelVersion` on the envelope and may shift typical scores; the ADR floor stays at 70 unless a new ADR supersedes this one with a documented re-calibration argument.
- Per-file scoring is the same kernel CRAP uses (`typhonjs-escomplex` with the `typescript: true` parse flag). Parse failures return `null` and the row is dropped from the envelope — a zero MI would be a phantom floor violation no source change can fix.
- Cross-references: [`docs/patterns.md` § "Maintainability baseline ratchet"](./patterns.md#maintainability-baseline-ratchet) is the operator-facing refresh runbook; the [`.agents/schemas/baselines/maintainability.schema.json`](../.agents/schemas/baselines/maintainability.schema.json) schema description names the floor target (rollup `min`) explicitly and is the ported contract from mandrel; the [Epic #6 Tech Spec](https://github.com/dsj1984/athportal/issues/196) carries the dimension's harness rationale.

---

## Numbered ADR series under `docs/decisions/`

New ADRs adopt a one-file-per-record layout under [`docs/decisions/`](./decisions/) with a leading four-digit sequence number. They sit alongside (not inside) the seed-set headings above; the seed set is preserved verbatim for historical continuity, while the numbered series is the writing surface for new decisions from Epic #5 onward.

- [`0001-sentry-org-and-region.md`](./decisions/0001-sentry-org-and-region.md) — Sentry organization (`athportal`), EU (Frankfurt) data-residency region, and the three-project layout (workers / web / mobile) that Story #255's per-runtime init wrappers depend on. Builds on ADR-012 (observability vendor stack).
- [`0002-log-sink-vendor.md`](./decisions/0002-log-sink-vendor.md) — Better Stack Logs as the managed log-sink vendor for the Cloudflare Logpush job declared in `apps/api/wrangler.toml` (Story #272). Three vendors evaluated (Better Stack Logs, Datadog Logs, Axiom) with per-GB pricing as of 2026-05-17; $30/month ceiling for the log sink alone; EU (Frankfurt) data-residency mirrors ADR-0001. Builds on ADR-012 (observability vendor stack).
- [`0003-uptime-vendor.md`](./decisions/0003-uptime-vendor.md) — Better Stack as the external uptime-probe vendor (Story #254). Probes hosted on infrastructure independent of Cloudflare (AWS / Hetzner / GCP probe network); three monitors at 60-second cadence with two-consecutive-failure threshold; IaC at `infra/uptime/betterstack.yml`. Builds on ADR-012 (observability vendor stack).
- [`0004-acceptance-email-capture.md`](./decisions/0004-acceptance-email-capture.md) — In-memory `EmailInbox` fixture (not a Mailpit container) as the email-capture mechanism for the Epic #5 observability acceptance scenarios (Story #307). Vendor emails originate from SaaS — fidelity is identical between the two designs, so the cheaper hermetic option wins. Builds on ADR-009 (BDD acceptance layer) and ADR-012 (observability vendor stack).
- [`0005-dependency-update-posture.md`](./decisions/0005-dependency-update-posture.md) — Renovate (not Dependabot) as the scheduled dependency-update bot (Story #311). Weekly Monday window in `America/New_York`, vendor-family grouping, patch / minor auto-merge, major-version approval via the Dependency Dashboard, `vulnerabilityAlerts` running out-of-band. Builds on ADR-011 (supply-chain CVE gate) — Renovate proposes updates; the CVE gate decides whether they ship.
- [`0006-local-hook-stack.md`](./decisions/0006-local-hook-stack.md) — Local hook stack v1: `knip` (strict, no baseline; `--include files,dependencies` at pre-push and full strict pass in CI), `markdownlint-cli2` (relaxed line-length and table-style; full repo at pre-push, staged at pre-commit), `secretlint` (pre-commit only — the four-channel secret-scanning boundary: gitleaks-pr on PR diff, gitleaks-history on post-merge full-history, trufflehog on nightly full-history, secretlint on pre-commit local), and the first `.husky/pre-push` (sequential `typecheck → lint → knip:fast → lint:baseline:check → lint:steps`, < 15 s wall-clock target). Story #310.
- [`0007-ui-styling-convention.md`](./decisions/0007-ui-styling-convention.md) — ADR-0007: Tailwind-utility-first UI styling convention, primitives over BEM (Story #834, Epic #828). Codifies the implicit convention left by the Epic #702 design-system foundation (primitive library + `@theme` token catalogue in `apps/web/src/styles/global.css`).
- [`0007-test-code-crap-mi-scope.md`](./decisions/0007-test-code-crap-mi-scope.md) — ADR-022: test code is in scope for the CRAP + Maintainability ratchets, measured against a single uniform production floor (MI `min >= 70`, CRAP `methodsAbove20 == 0`) rather than a separate lower `tests/**` floor (Story #1039, Epic #1001). Phase 0 breach catalogue: 0 of 142 test files below the MI floor, ≤ 11 worst-case CRAP-axis methods concentrated in one property test. Reverses the ADR-015 coverage-scope exclusion for CRAP + MI only; cross-references ADR-018 and ADR-019. (Shares the `0007` filename prefix with `0007-ui-styling-convention.md`; disambiguated by ADR number.)

---

## Error-handling pattern: tagged-union now, framework-promote on trigger

**Status**: Accepted (2026-05-19, Epic #386, Story #410)

**Context**: `apps/api/src/routes/v1/users/role.ts` was carrying three single-use error classes (`LastAdminError`, `ForbiddenError`, `NotFoundError`) whose only consumer was the route's own catch block. The classes added ceremony without buying inheritance, polymorphism, or cross-route reuse — the catch site degenerated into an `instanceof` chain over a closed set of three options. Promoting these to a framework-wide `ApiError` base class plus a Hono `app.onError` middleware would be premature: there is exactly one route emitting them, and the canonical `{ success: false, error: { code, message } }` envelope from ADR-002 is already centralized in `@repo/shared/schemas`. Lifting machinery for a single call site would invert the cost curve — more abstraction surface than benefit.

**Decision**:

- **Today (this route only)**: collapse the three classes into a discriminated union `type RouteError = { code: 'LAST_ADMIN' } | { code: 'FORBIDDEN' } | { code: 'NOT_FOUND' }`. Throw sites emit `RouteError` values (wrapped via a small helper that attaches the tagged payload as `cause` on a plain `Error`); the catch site is an exhaustive `switch (err.code)` mapping each discriminant to the existing HTTP response. HTTP status codes and response bodies stay byte-identical — the refactor is internal-only and the existing contract tests pass unchanged.
- **The three current codes** are `LAST_ADMIN`, `FORBIDDEN`, and `NOT_FOUND`. They map to `409`, `403`, and `404` respectively, preserving the prior class-based contract.
- **Framework-promote trigger**: when the **next** route needing one of these conditions either (a) introduces a status code or error-envelope shape that does not fit the existing three codes, or (b) duplicates this catch-shape across a second route, **open a follow-up Epic** to lift `RouteError` to a shared `ApiError` base class in `packages/shared` (alongside the existing `@repo/shared/schemas` error envelope) and a Hono `app.onError` middleware in `apps/api/src/middleware/`. The middleware would centralize the `(code → HTTP status + body)` mapping so route handlers can throw a single typed error and let the platform render it.
- **Until that trigger fires**, additional routes that need only the existing three codes MAY reuse the same tagged-union pattern locally (a duplicated `type RouteError` declaration in the new route's file is acceptable). The second occurrence is the signal to promote, not the first.

**Consequences**:

- The role-mutation route gains exhaustiveness from the TypeScript compiler — adding a fourth code without updating the switch is a type error, not a runtime fallthrough.
- The route loses three class declarations and one `instanceof` chain in exchange for one type alias, one helper, and one switch. Net SLOC is lower and the catch site reads as a flat mapping.
- No change to the public HTTP API surface. Contract tests in `apps/api/src/routes/v1/users/` continue to pin the wire shape, and the refactor is structurally invisible to clients.
- The promotion landing zone (`packages/shared` for the `ApiError` base class, `apps/api/src/middleware/` for the `app.onError` middleware) is named here so the follow-up Epic has unambiguous targets when the trigger fires. The trigger condition is intentionally concrete (a new code or a second catch site, not a vague "when it feels like time") so the promotion decision is mechanical rather than judgemental.
- This ADR complements ADR-002 (`withErrorHandler` middleware): ADR-002 governs the response envelope shape that the eventual `app.onError` middleware will produce; this ADR governs the in-route error-discrimination pattern that feeds it.

**Rejected — lift `ApiError` to `packages/shared` now (no waiting trigger)**: Premature abstraction. With one route emitting three codes, the framework surface would carry zero callers beyond the prototype. The trigger condition above ensures the promotion happens when there is real cross-route demand, not on speculation.

**Rejected — keep the three error classes**: The catch site was an `instanceof` chain over a closed set, which is the canonical signature for a discriminated union. The classes carried no behaviour beyond their constructor — they were tagged values masquerading as types.

---

## ADR-020 — Required-check set on `main`'s branch-protection ruleset (post-Phase-2)

**Status**: Accepted (2026-05-19, Epic #386, Story #411)

**Context**: Epic #386's Phase 2 cuts landed a defensible, minimal required-check set on `main`'s branch-protection ruleset — replacing the previous over-broad list that mixed informational signal with merge-gating checks. Without a written record of which checks are required, the next operator to re-derive the ruleset (after a fork, a repo-permissions reset, or a tooling migration) has no canonical reference and has to reverse-engineer the intent from CI history. This ADR pins the post-Phase-2 list so the ruleset is reproducible from documentation alone, and so future Epics adding new workflows have an unambiguous bar for whether the new check belongs in the required set.

A separate concern is CodeQL. Story #413 added [`.github/workflows/codeql.yml`](../.github/workflows/codeql.yml) for static-analysis signal, but CodeQL is **informational-only**: a CodeQL alert does not block merge. The workflow runs on a schedule and on `pull_request`, but its check is intentionally **not** required at Epic close. Naming this explicitly here prevents a future operator from "tidying up" by promoting CodeQL to required when the project's posture is the opposite.

**Decision**:

- **The canonical required-check set on `main`'s branch-protection ruleset is the following 11 status checks** (names match the GitHub Actions job IDs as they appear in the branch-protection UI's "Require status checks to pass before merging" picker):
  1. `lint`
  2. `typecheck`
  3. `test`
  4. `quality-baselines`
  5. `acceptance-smoke`
  6. `lint-steps`
  7. `supply-chain-security`
  8. `gitleaks-pr`
  9. `build`
  10. `bundle-size-baseline`
  11. `migration-label-guard.guard`
- **CodeQL (`.github/workflows/codeql.yml`) is informational-only.** It runs on every PR and on schedule, but its check is **NOT** required at Epic close and **MUST NOT** be added to the required-check set on `main`. A CodeQL alert is a signal for the author and reviewer to triage; it is not a merge gate.
- **The operator promotes the required-check set via the GitHub branch-protection UI** at `Settings → Rules → main → Require status checks to pass`. This ADR documents the target; it does not perform the promotion. The promotion is a manual operator step because GitHub's API surface for branch protection requires elevated permissions that the agent does not hold.
- **New required checks land in this ADR before they land in the ruleset.** A future Epic adding (for example) a `mutation-baseline` required check must first land an ADR superseding this one with the updated list; the branch-protection UI change follows the ADR, never precedes it. This sequencing prevents the ruleset and the documentation from drifting.

**Rejected — include CodeQL in the required set**: CodeQL alerts are noisy at the project's current scale (security baseline is already enforced by `supply-chain-security` + `gitleaks-pr`; CodeQL adds defense-in-depth, not a new gating dimension). Promoting CodeQL to required would block legitimate merges on advisories that have no upstream patch and no in-repo remediation, with no escape hatch short of disabling the check entirely.

**Rejected — list every workflow that runs on PR**: The required-check set is **what gates the merge**, not **what runs on PR**. Nightly schedules, informational scans, and advisory dashboards run on PR for visibility but do not block merge. Conflating "runs on PR" with "required" inflates the required set, makes the ruleset brittle to refactors (any rename breaks the gate), and dilutes the signal of what failure actually blocks a merge.

**Consequences**:

- The 11-check list is the reproducible target for the branch-protection ruleset. Re-applying the ruleset after a fork or permissions reset is mechanical: copy the list, paste it into the GitHub UI picker, save.
- Removing or renaming any of the 11 jobs in their owning workflow is a breaking change to this ADR and to the ruleset. The Epic that touches the job MUST update both this ADR and the branch-protection ruleset in the same change.
- CodeQL stays a first-class signal that the author and reviewer read, but it stays out of the merge-blocking path. If the project's security posture later demands CodeQL as a gate, a new ADR supersedes this one and the operator promotes the check via the UI.
- Cross-references: [`docs/runbooks/branch-protection-setup.md`](./runbooks/branch-protection-setup.md) is the operator-facing setup runbook; that document points back here for the canonical list. The ADR-016 entry above (`quality` workflow as the canonical PR quality gate, 2026-05-17) is the precedent for treating a named CI surface as a load-bearing ruleset target — this ADR extends that pattern from a single workflow to the 11-check post-Phase-2 set.

## ADR-021 — Roster invites are separate from Clerk org-admin invitations

**Status**: Accepted (2026-05-26, Epic #11)

**Context**: Epic #10 shipped the org-admin invitation surface — Clerk-mediated invites that provision a new athlete or coach identity into an org. Epic #11 introduces a second invite shape: a **coach-issued roster invite** that places an **already-onboarded** athlete on a specific team. The two flows look superficially similar (an email, a tokenized link, an accept/decline page), but their semantics are different: an org-admin invite mints a Clerk identity and an `athlete_membership` row from nothing; a roster invite operates on an existing identity and produces an `athlete_membership` + a `roster_entry` on accept. Conflating them onto a single `invitations` table would force one of: (a) sentinel columns to disambiguate "this row is a roster invite, ignore the Clerk-side fields" — a classic table-of-many-things smell, or (b) one path silently doing the wrong thing because the schema couldn't distinguish.

**Decision**:

- **`roster_invite` is a separate table from `invitations`.** The two carry different invariants (Clerk-mediated identity provisioning vs. team-scoped placement of an existing identity), different lifecycle states (`pending` / `accepted` / `declined` / `expired` / `revoked` for both, but driven by different transition rules), and different observation surfaces (org-admin pending-invitations page vs. coach team-roster page). Schema-level separation makes both surfaces queryable without a discriminator column and makes the cross-tenant triggers per-table.
- **The accept handshake does NOT mint identities — JIT-provisioning on accept is out of scope for MVP.** A roster invite operates only on an **already-onboarded** athlete identity. When the public accept route resolves the recipient by email and finds no matching `users` row in the invite's org, it **refuses with `409 RECIPIENT_NOT_FOUND`** ([`apps/api/src/routes/v1/public/roster-invites.ts`](../apps/api/src/routes/v1/public/roster-invites.ts) — recipient-resolution guard) — it does **not** create a user. Identity creation is owned exclusively by Clerk at sign-in (the `requireInternalUser` JIT provisioner, [Epic #9](https://github.com/dsj1984/athportal/issues/9)); a public, unauthenticated token handshake must never be an identity-minting surface. The "chain an unprovisioned recipient into sign-up" experience is deferred to a separate V1.0 Story. This scope-out is recorded explicitly (Story [#1050](https://github.com/dsj1984/athportal/issues/1050), F32) so the Plan-vs-build sweep does not re-litigate it.
- **A 7-day TTL is the default invite lifetime.** Application-side at invite creation; persisted as `expires_at` (unixepoch). The TTL is reviewable copy on the invite email and a row attribute the coach can see on the team-roster page.
- **Expiry is lazy, not scheduled.** A `pending` row whose `expires_at` has elapsed is transitioned to `'expired'` in the same transaction that observes it (read or accept attempt). There is no nightly cron — the operator surface and the public accept route are the only readers that matter, and both touch the row.
- **Jersey-number uniqueness is soft, scoped per team.** A `(team_id, athlete_user_id)` partial unique index over `ended_at IS NULL` prevents the same athlete from holding two active entries on the same team, but two athletes on the same team MAY share a jersey number (the migration's CHECK only validates the grammar). Uniqueness is a coaching convention, not a data invariant — enforcing it at the DB level would refuse legitimate edge cases (a coach giving two newcomers the same temporary number while the season starts).
- **Cross-team and cross-org refusal returns 404, not 403.** The coach roster route under `/app/coach/teams/[teamId]/roster` returns a not-found surface to a coach not assigned to that team (or in a different org), not an explicit "forbidden." Disclosing existence of a team to an unauthorized coach is itself an information leak; the 404 surface refuses to confirm or deny the team's existence. The wire-shape contract is pinned at the contract tier; the user-visible refusal is asserted in `tests/features/coach/roster/team-scoped-access.feature` (AC-2 and AC-3).

**Rejected — extend `invitations` with a `kind` column**: A discriminator column makes every query in either surface dance around the `kind` filter, makes the cross-tenant trigger logic per-row instead of per-table, and centralizes two unrelated lifecycles in one place. The cost of a second table is one migration; the cost of the discriminator is a permanent tax on every query in both surfaces.

**Rejected — eager expiry via a nightly job**: A scheduled job adds an operational moving part (cron health, missed runs, drift between persisted and observed status) for no read-path benefit. Lazy expiry produces the same observable status with zero schedule.

**Rejected — return 403 on cross-team / cross-org roster access**: A 403 confirms the team exists, which is itself an information leak across tenants. The 404 surface refuses to disclose existence at all.

**Consequences**:

- The coach-roster surface gets its own table and route prefix without polluting the org-admin invitation surface. Either surface can evolve (extra columns, lifecycle states, observation queries) without touching the other.
- The 7-day TTL is the user-visible contract. Changing it is a copy-and-schema change pair — bump the default in code and update the invite-email copy plus this ADR in the same PR.
- Lazy expiry means a long-paused worker won't leak stale `pending` invites; the next read transitions them. The trade-off is that an unobserved invite stays `pending` in the persisted row until something queries it — that's fine because the only readers are operator surfaces that look at the row.
- The 404 cross-tenant refusal is the canonical pattern for any future team-scoped surface in this project. New routes that gate on team-membership SHOULD reuse the `requireCoachOnTeam` predicate (see [`docs/patterns.md` § Coach-on-team scoping predicate](./patterns.md#coach-on-team-scoping-predicate)) and the 404-on-refusal contract.
- Acceptance assertions for the roster surface live in `tests/features/coach/roster/{digital-roster,roster-invites,team-scoped-access}.feature`; contract-tier shape assertions live under `apps/api/src/routes/v1/coach/roster*.contract.test.ts` and `apps/api/src/routes/v1/public/roster-invites.contract.test.ts`.

## ADR-022 — Privilege role and team-graph membership are orthogonal; role escalation is invitation-only

**Status**: Accepted (2026-05-29, Story #964)

**Context**: Story #964 (surfaced by the [#945](https://github.com/dsj1984/athportal/issues/945) Session-2 sweep) observed that `/onboarding` has no persona-selection step — every self-signup user persists as `users.role = 'member'` — and asked for a product call between **Option A** (add a self-serve `athlete | coach | org-admin` picker to the form) and **Option B** (keep the form as-is; roles come only from invitations). Analysis of the shipped model showed the question rests on a conflation: it assumes `athlete | coach | org-admin` are values of one role field. They are not. `users.role` enumerates `dev_admin | org_admin | team_admin | member`; "coach" and "athlete" are not role values at all. This ADR records the model that already exists, names the two axes explicitly so the next sweep doesn't re-derive them, and fixes the terminology and extension-point decisions.

**Decision**:

- **Two orthogonal axes.** Identity is expressed across a *privilege* axis and a *team-graph* axis, and they are not the same field:
  - **Privilege** — `users.role` (`dev_admin | org_admin | team_admin | member`, [`packages/shared/src/rbac/types.ts`](../packages/shared/src/rbac/types.ts)). Answers "what administrative capability does this user have?" `member` is the no-admin baseline.
  - **Team-graph position** — the join rows `coach_assignments` and `athlete_memberships` ([Epic #9](https://github.com/dsj1984/athportal/issues/9)). Answers "whose team is this user on, and as what?" A user **is a coach** of a team iff an active (`ended_at IS NULL`) `coach_assignments` row exists; coach authorization is derived dynamically via `requireCoachOnTeam(actor, teamId, db)` ([`packages/shared/src/rbac/coachOnTeam.ts`](../packages/shared/src/rbac/coachOnTeam.ts)), **never** from `users.role`. A coach's privilege role is `member`.
- **`member` is the privilege baseline, not a synonym for "athlete".** Parents ([`parent_athlete_links`](../packages/shared/src/db/schema/parentAthleteLinks.ts)) and signed-in users not on any roster are also `member`. Athlete-ness is **derived** from holding an active `athlete_membership`, not from a stored role.
- **Terminology is layered (no enum rename).** Keep `member` as the internal privilege enum value; surface **"Athlete"** in user-facing copy. The persona is a display/domain label over the privilege baseline.
- **Role escalation is invitation-only** (this ratifies the de-facto Option B). Self-signup → `member`, always; `/onboarding` never writes `role` (it echoes `auth.role`, and [`onboard.contract.test.ts`](../apps/api/src/routes/v1/auth/onboard.contract.test.ts) asserts `role === 'member'`). Coach/athlete memberships are assigned at **invitation-accept** (the `clerk-invitation-accepted` webhook and the roster-invite accept path). `org_admin` / `dev_admin` are bootstrapped **out-of-band**; `invitations.role` is a frozen `['coach','athlete']` tuple and cannot mint an admin.
- **Coach designations are a documented future extension point, not built now.** Head coach / assistant coach / sport-specific coach will be expressed by an **additive, nullable** `coach_assignments.designation` column (`null` = unspecified coach) — the per-team join-row shape already absorbs this without restructuring, and `invitations.role` stays `'coach'` with the designation riding alongside. Deferred to the coach-management Epic.

**Rejected — Option A (self-serve role selection on `/onboarding`)**: There is no `coach` / `org_admin` value in `users.role` to write; coach/athlete are team-graph relationships that require a team + org context which does not exist at signup time. Letting a user self-claim `coach` or `org_admin` breaks the trust chain ([`docs/personas.md`](./personas.md) — coaches are vetted, org admins are onboarded by staff). Shipping it would require widening the role enum and contradicting the separations of duty the wedge depends on.

**Rejected — rename `users.role` `member` → `athlete`**: A hard cutover across the RBAC enum, the rules table, the JIT-provisioning default, every fixture, and the contract suite — and it would mislabel parents and unrostered members as athletes. The persona/privilege conflation is exactly what this ADR separates.

**Consequences**:

- The three test plans #964 cited (`tp-identity-signup-coach`, `tp-identity-signup-org-admin`, `tp-identity-role-assignment`) referenced the **retired** `.plan.md` format (Epic #997) and do not exist on `main`. They are **not** re-authored; the recipient-accept path they wanted is already covered by `tests/features/coach/roster/roster-invites.feature` ("Scenario: Recipient accepts the invite and joins the roster").
- Any future role/membership surface reads from the correct axis: admin capability from `users.role`, team relationship from the membership joins via the scoped predicates.
- Building coach designations later is an **additive migration**, not a redesign — recorded here so the coach-management Epic inherits the shape instead of rediscovering the gap.
- `/onboarding` keeps its identity/legal/age-only shape. A future change that adds any role-affecting field to the form must update this ADR in the same PR.

## ADR-023 — Display name is Clerk-owned identity data, promoted into `users` at onboarding and kept fresh via `user.updated`

**Status**: Accepted (2026-05-30, Story #1054)

**Context**: The system had **no canonical home for a person's name** — `users` stored only `email` ([`users.ts`](../packages/shared/src/db/schema/users.ts)), and the coach roster projection derived a display name from the email local-part ([`deriveFullName(row.athleteEmail)`](../apps/api/src/routes/v1/coach/roster.ts)), so `e2e-roster-s4-001` rendered as "E2e Roster S4 001" (Story [#1054](https://github.com/dsj1984/athportal/issues/1054), F33). The real name lives in Clerk: `onboard.ts` already fetches the Clerk user for the verified-email re-query ([`onboard.ts` `fetchPrimaryEmailVerified`](../apps/api/src/routes/v1/auth/onboard.ts)), whose object carries `firstName` / `lastName`, but discarded everything except the email. An earlier plan proposed copying the coach-typed **invite** first/last onto the `users` row at accept-time — but per ADR-021 the accept path only operates on an **already-onboarded** Clerk identity, so the athlete already has a real name in Clerk and the coach's invite text is a guess. The invite name is the wrong source of truth.

**Decision**:

- **Name is Clerk-owned identity data, promoted into `users` at the same lifecycle points `email` is** — directly mirroring the ADR-005 email-promotion precedent. Two nullable columns (`first_name`, `last_name`) are added to `users` via an additive migration ([`0010_users_name.sql`](../packages/shared/src/db/migrations/0010_users_name.sql)); they are nullable because the JIT-provisioned placeholder row exists before any name is known and a Clerk profile may omit either field.
- **Onboarding promotes the Clerk name inside the same transaction that promotes the verified email.** `fetchPrimaryEmailVerified` is extended to return `firstName` / `lastName` from the **already-fetched** Clerk user object — no extra Clerk API call — and `stampUserRow` writes them alongside `email`. Pinned by `onboard.contract.test.ts`.
- **A Clerk `user.updated` webhook keeps the name fresh on profile edits** ([`clerk-user-updated.ts`](../apps/api/src/routes/webhooks/clerk-user-updated.ts)). It **verifies the Standard Webhooks (Svix) signature** before reading any field — the signature is the security boundary, identical to the `clerk-invitation-accepted` handler — resolves the local row by `clerk_subject_id`, and re-promotes the normalised name. Empty / whitespace Clerk values normalise to `null`. The handler emits no log lines (names are PII per security-baseline § Data Leakage & Logging).
- **The email-derived name is now a FALLBACK only.** The roster projection reads `users.first_name` / `users.last_name` and falls back to `deriveFullName(email)` only when **both** columns are null.
- **The invite `first_name` / `last_name` are retained only as a pre-onboarding display seed** (the coach pending-invite strip). They are **not** written as the post-accept athlete display name — the accept path in [`roster-invites.ts`](../apps/api/src/routes/v1/public/roster-invites.ts) does not touch `users.first_name` / `users.last_name`.
- **No backfill.** The app is pre-launch — there are no existing onboarded users to reconcile. Recorded here so the omission is intentional, not an oversight.

**Rejected — copy the coach-typed invite first/last onto `users` at accept-time**: The accept path operates on an already-onboarded Clerk identity (ADR-021), so the athlete already has a real Clerk name; the coach's invite text is a guess that would overwrite the truth. The invite name is the wrong source of truth for the canonical display name.

**Consequences**:

- Name surfaces across the app read from one canonical home (`users.first_name` / `users.last_name`) with a deterministic email-derived fallback — not from per-surface email parsing.
- Clerk remains the single source of truth for identity data: a profile edit propagates via the `user.updated` webhook the same way the email is owned by Clerk and promoted at onboarding.
- Adding the `user.updated` webhook means the `CLERK_WEBHOOK_SIGNING_SECRET` binding now gates two webhook routes; the operator must subscribe the `user.updated` event in the Clerk dashboard for the fresh-on-edit behaviour to fire (onboarding promotion works regardless).
- The migration is additive (nullable `ADD COLUMN`) — it does not trip the ADR-017 destructive-migration guard.
