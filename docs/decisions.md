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
