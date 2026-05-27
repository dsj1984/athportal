// apps/api/src/env.ts
//
// Canonical Env type for the @repo/api Cloudflare Worker.
//
// This file is the single declaration of the runtime bindings the Worker
// reads from `c.env`. Every middleware and route that needs a binding
// imports its slice from here rather than re-declaring its own. The
// per-middleware interfaces under `apps/api/src/middleware/**` keep
// structural compatibility with this type so a contract test can still
// inject a narrow stub without having to satisfy the full binding
// surface.
//
// Bindings declared in wrangler.toml MUST appear here so TypeScript
// catches a missing binding before the deploy hits Cloudflare. Adding a
// binding to wrangler.toml without adding it here is a review blocker —
// the contract surface is what the test harness binds against.

/**
 * Structural shape of the Workers Analytics Engine dataset binding the
 * request-completion middleware consumes. Declared here (not imported
 * from `@cloudflare/workers-types`) so consumers and tests can supply a
 * stub without pulling the full type package.
 *
 * The real binding exposes a wider surface; this Env only commits to the
 * single method the middleware calls — fire-and-forget `writeDataPoint`.
 */
export interface AnalyticsEngineDataset {
  writeDataPoint: (event: unknown) => void;
}

/**
 * Canonical Env type for the @repo/api Worker.
 *
 *   - `ANALYTICS` — the Analytics Engine dataset binding declared in
 *     wrangler.toml. One row per request, written by the
 *     request-completion middleware (Story #257). The matching Logpush
 *     job ships rows out of Cloudflare to the managed sink chosen in
 *     ADR-0002 (`docs/decisions/0002-log-sink-vendor.md`).
 *   - `RUNTIME_ENV` — deploy environment label (`staging` /
 *     `production`). Optional in local dev where the middleware
 *     defaults to `development`.
 *   - `RELEASE_SHA` — deploy SHA stamped on every LogEvent. Optional in
 *     local dev where the middleware defaults to `unknown`.
 */
export interface Env {
  ANALYTICS: AnalyticsEngineDataset;
  RUNTIME_ENV?: 'development' | 'staging' | 'production';
  RELEASE_SHA?: string;

  /**
   * Clerk backend secret key (`sk_test_...` or `sk_live_...`). Required
   * at runtime for `clerkAuth` to validate Clerk-issued session tokens
   * via `@clerk/backend`. Stored as a Worker secret in production;
   * loaded from `.dev.vars` (gitignored) in local dev.
   */
  CLERK_SECRET_KEY: string;

  /**
   * Clerk frontend publishable key (`pk_test_...` or `pk_live_...`).
   * The API does not parse this value directly, but Clerk's backend SDK
   * derives the expected token issuer from it for authorized-party
   * checks. Surfaced on Env so apps/web and apps/api share one source
   * of truth at deploy time.
   */
  CLERK_PUBLISHABLE_KEY: string;

  /**
   * Clerk webhook signing secret (`whsec_...`). Required by
   * `verifyWebhook` from `@clerk/backend/webhooks` to validate the
   * Standard Webhooks signature on every `invitation.accepted` POST
   * (Epic #10 / Story #655 / Task #666). A missing or wrong secret
   * causes the verifier to throw, which the handler maps to 401 with
   * the canonical UNAUTHENTICATED envelope — never echoing the
   * verifier's error detail to the caller.
   */
  CLERK_WEBHOOK_SIGNING_SECRET: string;

  /**
   * Drizzle handle published into `c.var.db` by `withDb` (Story #760).
   *
   * The host (Node dev server in `apps/api/src/local.ts`, future
   * Workers entrypoint in Epic #27) constructs the handle at wrap time
   * and passes it through `c.env`. Typed as `unknown` for the same
   * driver-agnostic reason as `InternalUserDb` in
   * `./middleware/auth.ts` — downstream consumers narrow structurally
   * to the methods they call.
   *
   * Required at runtime. `withDb` throws synchronously when this
   * binding is missing.
   */
  DB: unknown;

  /**
   * Gated dev-only flag exposing `POST /api/v1/_debug/create-test-user`
   * (Story #963). Compared to the literal string `'true'`; anything
   * else (including unset, `'false'`, `'1'`, `'TRUE'`) is the closed
   * state and the route returns 404 for every verb.
   *
   * Production deployments NEVER set this. Local dev and the acceptance
   * CI job set it to `'true'` so the Playwright fresh-user fixture can
   * mint a brand-new `+clerk_test@` user without going through the
   * Cloudflare-Turnstile-gated `/sign-up` form.
   */
  DEBUG_TEST_USER_CREATION_ENABLED?: string;

  /**
   * Origin connection string for the persistence layer (Story #760).
   *
   * Local dev: `file:packages/shared/data/local.db` (better-sqlite3).
   * Staging / production: `libsql://<db>.turso.io` (Workers + libsql).
   *
   * The Worker host (Epic #27) constructs the `DB` handle from this
   * URL per-request. Local dev constructs `DB` once at startup and
   * passes it pre-built — the URL is surfaced here only for the
   * preflight + diagnostics surface.
   */
  DATABASE_URL: string;
}
