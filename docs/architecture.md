# Athlete Portal — System Architecture

> **Forward-looking target.** This is the architecture the corpus Epics will deliver. Sections below describe the intended shape; each becomes canonical as the corresponding foundation Epic lands. Until then, treat concrete paths as planned, not current.
>
> Source corpus: [`docs/corpus.json`](./corpus.json). Foundation Epics: `foundation-monorepo-and-tooling`, `foundation-cicd-and-deploy`, `foundation-testing-infrastructure`, `foundation-observability`, `foundation-quality-baselines`.

## 1. Tech Stack

| Layer | Choice | Workspace |
|---|---|---|
| Monorepo | Turborepo + pnpm workspaces | `turbo.json`, `pnpm-workspace.yaml` |
| Web | Astro 5 SSR on Cloudflare Pages, React islands, Tailwind v4, Biome (primary) + ESLint (secondary, workspace-scoped) | `apps/web/` |
| Mobile (MVP) | **Mobile-web PWA only** — installable from `apps/web/`. Native iOS/Android defers to v1.0. | `apps/web/` |
| Mobile (v1.0) | Expo (React Native) for iOS + Android | `apps/mobile/` |
| API | Cloudflare Workers, Hono router, OpenAPI via `@hono/zod-openapi` | `apps/api/` |
| Database | Turso (libSQL) via Drizzle ORM; ephemeral SQLite for tests | `packages/shared/src/db/` |
| Validation | Zod at every system boundary | `packages/shared/src/schemas/` |
| Auth | Clerk (`@clerk/astro` at MVP; `@clerk/clerk-expo` at v1.0). Email+password AND magic link both first-class at MVP. JIT user provisioning in middleware. | `apps/api/src/middleware/auth.ts` |
| Media | Mux direct uploads + HLS playback; Cloudflare Images for non-video assets | `apps/api/src/routes/v1/media/` |
| Notifications (MVP) | Web Push only | — |
| Notifications (v1.0) | APNS + FCM via Expo push pipeline | — |
| Observability | Sentry across runtimes, Cloudflare Workers Analytics Engine + Logpush, Better Stack uptime probes | `packages/shared/src/observability/` |
| Testing | Vitest (unit + contract), Playwright + playwright-bdd (web acceptance), Detox (mobile acceptance, v1.0), Stryker (mutation) | see [`testing-strategy.md`](./testing-strategy.md) |
| CI | GitHub Actions; staging auto-deploy on push to `main`, production gated by GitHub Environments | `.github/workflows/` |

**Boundary rule.** Workspaces only cross via `@repo/*` package aliases (`@repo/shared`, `@repo/api`, `@repo/web`, later `@repo/mobile`). No relative imports across workspace roots.

## 2. Workspace Mapping (target shape)

### `@repo/shared` — `packages/shared/`

Single source of truth for cross-workspace types and primitives. Owns:

- `src/db/schema/**.ts` — Drizzle table definitions. Domains accrete as Epics land; corpus is authoritative for which domains are MVP vs deferred.
- `src/db/seed.ts` — Deterministic seed data. **Never modify without explicit approval.**
- `src/schemas/**.ts` — Zod schemas for every API payload, organized by domain.
- `src/rbac/{policy,rules,types}.ts` — Role-based access control. Three-tier role model: `dev_admin` (global) / `org_admin` (org-scoped) / `team_admin` (team-scoped). Exhaustively unit-tested across `(role, resource, action)` triples — branch-coverage floor ≥95%.
- `src/testing/**.ts` — `freshDb()` for contract tests + role-aware fixture helpers.
- `src/observability/redaction.ts` — Edge-side PII redactor used by the Hono request-completion logger.

### `@repo/api` — `apps/api/`

Hono router on Cloudflare Workers. Composed from per-domain routers under `src/routes/v1/`. Domains correspond to corpus capabilities; only routers for landed Epics exist at any given time.

**Route mount.** All API routes mount under `/api/v1`. Pre-MVP, breaking changes inside `/api/v1` are allowed; post-MVP, `/api/v1` is additive-only and breaking changes ship to `/api/v2` with a six-month deprecation overlap. See [ADR-016 in `docs/decisions.md`](./decisions.md#adr-016--apiv1-route-mount-and-post-mvp-deprecation-policy) for the full policy.

Auth contract: every protected route runs `clerkAuth` then `requireInternalUser`. JIT provisioning ensures a `users` row exists on first authenticated request. The onboarding gate redirects callers with `users.onboarded_at IS NULL` to `/onboarding`.

### `@repo/web` — `apps/web/`

Astro 5 SSR on Cloudflare Pages with React islands.

- `src/pages/**.astro` — Routes. Route registry maintained as routes land.
- `src/components/**.tsx` — React islands. **`data-testid` naming follows the `section-element-action` convention required by acceptance tests.**
- `src/middleware.ts` — Onboarding redirect, RBAC checks for protected routes, audit-friendly logging.
- `src/lib/api/useApiClient.ts` — Hono RPC client typed against `@repo/api`'s `AppType`.
- PWA manifest + service worker — mobile-web installability is the MVP mobile surface.

### `@repo/mobile` — `apps/mobile/` *(v1.0)*

Expo (React Native) workspace. Does not exist at MVP. Wired in as part of the v1.0 native-apps Epic.

## 3. Cross-Cutting Flows

### 3.1 JIT user provisioning + onboarding gate

Clerk webhooks are a defensive sync only. The primary path is **Just-In-Time** provisioning in middleware:

```
Browser → Clerk session → apps/web middleware → @repo/api middleware/auth.ts
  └→ requireInternalUser():
       ├─ if users row exists by clerkId → attach to context
       └─ else → INSERT users row → attach to context
  └→ if users.onboarded_at IS NULL → redirect to /onboarding
```

This eliminates the "Clerk webhook race" where a webhook had not landed before the first authenticated request. A `userLegalAgreements` table records terms/privacy acceptance stamped at the close of onboarding.

### 3.2 Mux direct upload + playback

```
Web UI → POST /api/v1/media/upload-sessions (returns Mux signed-upload URL)
  → client uploads bytes directly to Mux
  → Mux fires webhook → /webhooks/mux → highlights.status = 'preparing' → 'ready' | 'errored'
  → feed components subscribe to highlights and render the player when status = 'ready'
```

HLS playback uses Mux's adaptive player. Share tokens gate password-protected sharing via `/share/:shareToken`.

### 3.3 Cron + queue

The Worker exports `scheduled` and `queue` handlers via the default export wrapped by `Sentry.withSentry`. Specific cron jobs (event reminders, etc.) accrete per Epic.

### 3.4 Observability

- **Sentry** across all runtimes (`@sentry/cloudflare`, `@sentry/astro`; `@sentry/react-native` at v1.0). Sourcemap upload wired into CI.
- **Hono request-completion logger** at the Worker edge — emits to Cloudflare Workers Analytics Engine and Logpush. PII redaction at `packages/shared/src/observability/redaction.ts` runs at the edge **before** any payload leaves the Worker.
- **Better Stack uptime probes** at ≤5-minute cadence on api, web origin, and auth callback. Health endpoint at `/api/v1/health`.

## 4. Build, Test, and Deploy (target shape)

- `pnpm install` at the root sets up every workspace.
- `pnpm dev` runs api + web in parallel via Turbo. `pnpm dev:seeded` seeds the local DB first.
- `pnpm run lint` runs Biome + ESLint with the lint baseline ratchet (no new warnings allowed); `pnpm run typecheck` runs `tsc --noEmit` in every workspace.
- `pnpm run test` runs Vitest across all workspaces (unit + contract).
- Acceptance: `pnpm --filter @repo/web test:e2e` for Playwright. Detox wires in at v1.0.
- **Deploy.** Push to `main` auto-deploys both `apps/api` and `apps/web` to **staging**. **Production** is promoted via a separate `workflow_dispatch` workflow gated by GitHub Environment manual approval; secrets are environment-scoped, not repo-scoped. A `scripts/check-env.mjs` validator gates each deploy.
- **Quality baselines.** Seven baseline files under `baselines/` ratchet quality dimensions: `lint.json`, `crap.json`, `maintainability.json`, `coverage.json`, `mutation.json`, `lighthouse.json`, `bundle-size.json`. Each has a paired `<dim>:check` and `<dim>:update` script and a CI gate.
- **Pre-push hook.** Trimmed to `pnpm typecheck` + `pnpm lint:check` + `pnpm audit-check` to bound local push latency. CRAP, maintainability, coverage capture, and per-package mutation ratchet run as required CI checks and on the nightly mutation workflow.
- **Secret scanning.** TruffleHog (`--only-verified`) + `gitleaks-action` (full pattern scan) on every push to `main`. Both required.
- **Supply-chain CVE gate.** `pnpm audit` gate on critical/high vulnerabilities reachable in production code.

## 5. Safety Constraints

Per `AGENTS.md`:

1. Never modify seed data (`packages/shared/src/db/seed.ts`) without explicit approval.
2. Never change API route signatures (path, method, response shape) without updating the matching Zod schema in `@repo/shared`.
3. Never modify `apps/api/src/middleware/auth.ts` — security-critical.
4. Never delete or rename `data-testid` attributes without updating every binding in the step library.
5. Never commit secrets. Only `.env.example` is checked in.

## 6. Post-MVP Roadmap

Forward-looking surfaces are tracked as Epics on the **v1.0** and **Someday** milestones in this repo. Run `gh issue list --milestone "v1.0"` (or `Someday`) for the current bookmark set — there is no `roadmap.md`.
