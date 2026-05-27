// apps/api/src/middleware/auth.ts
//
// Production auth middleware for @repo/api.
//
// Listed in docs/architecture.md §5 as security-critical. Owned by
// Epic #7. The exported `clerkAuth` middleware runs first on every
// request (`app.use('*', clerkAuth())`) and validates the Clerk session
// token carried in either the `__session` cookie (browser flow) or an
// `Authorization: Bearer …` header (server-to-server flow). On success
// it writes the Clerk subject id (`sub` claim) into `c.var.clerkSubjectId`
// and yields to the next handler. On failure it returns 401 with the
// canonical error envelope:
//
//   { success: false, error: { code: 'UNAUTHENTICATED', message } }
//
// Stack traces and internal error details are NEVER echoed to the caller
// — per `.agents/rules/security-baseline.md` (Output & Rendering, Data
// Leakage & Logging) and Tech Spec #318 §Security.
//
// The companion `requireInternalUser` middleware (Task #343, same file)
// runs second under `app.use('/api/v1/*', requireInternalUser)` and is
// responsible for the JIT users-row lookup/insert.

import { verifyToken } from '@clerk/backend';
import { users } from '@repo/shared/db/schema';
import { eq } from 'drizzle-orm';
import type { MiddlewareHandler } from 'hono';
import type { Env } from '../env';
import type { DrizzleInsertChain, DrizzleSelectChain } from '../types/drizzle-structural';

/**
 * Hono variable surface contributed by `clerkAuth`. The middleware only
 * promises `clerkSubjectId`; `requireInternalUser` extends the
 * `c.var.auth` shape downstream with the resolved internal user.
 */
interface ClerkAuthVariables {
  clerkSubjectId: string;
}

export type ClerkAuthEnv = {
  Bindings: Env;
  Variables: ClerkAuthVariables;
};

/**
 * Canonical auth-error code surface. Kept narrow on purpose — the
 * RBAC-layer codes (`FORBIDDEN`, `LAST_ADMIN`, …) live in their own
 * routes. `UNAUTHENTICATED` is the only code this middleware emits.
 */
type AuthErrorCode = 'UNAUTHENTICATED';

interface AuthErrorBody {
  readonly success: false;
  readonly error: {
    readonly code: AuthErrorCode;
    readonly message: string;
  };
}

function unauthenticated(message: string): AuthErrorBody {
  return {
    success: false,
    error: { code: 'UNAUTHENTICATED', message },
  };
}

/**
 * Best-effort cookie parser scoped to a single cookie name. We avoid a
 * full RFC 6265 dependency here — the cookie header for our routes is
 * always produced by Clerk, so the format is constrained.
 */
function readSessionCookie(header: string | null | undefined): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith('__session=')) {
      const value = trimmed.slice('__session='.length);
      return value.length > 0 ? value : null;
    }
  }
  return null;
}

function readBearerToken(header: string | null | undefined): string | null {
  if (!header) return null;
  if (!header.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

/**
 * Resolve the Clerk session token from a request. Cookie takes precedence
 * over Authorization: server-rendered browser flows always carry the
 * `__session` cookie; the bearer fallback exists for server-to-server
 * callers that present a Clerk-minted token directly.
 */
function extractToken(req: Request): string | null {
  return (
    readSessionCookie(req.headers.get('cookie')) ??
    readBearerToken(req.headers.get('authorization'))
  );
}

/**
 * Structured reason codes the middleware emits on every 401 path. Kept
 * narrow and finite so triage queries against the Workers tail-log sink
 * stay grep-friendly. Reasons distinguish "no credential" from "credential
 * presented but rejected" from "credential verified but unusable" without
 * ever echoing the token, the secret key, or the cookie value.
 */
type AuthWarnReason = 'no-token' | 'verify-threw' | 'no-subject';

/**
 * Emit a structured warning for a 401 path. The Worker API does not
 * have a dedicated project-wide `logger` surface — `console.warn` is
 * captured by Cloudflare's tail-log pipeline (the same path
 * `wrangler tail` follows) and is the canonical structured-log surface
 * for this runtime. Wrapped in try/catch so a logging-layer fault can
 * never turn a failed-auth 401 into a user-visible 500.
 *
 * Per `.agents/rules/security-baseline.md` (Data Leakage & Logging): the
 * payload MUST NOT carry the token, secret key, cookie value, or any
 * other secret material — only the reason discriminator and (optionally)
 * the thrown error's class name.
 */
function logAuthWarn(payload: { reason: AuthWarnReason; errorClass?: string }): void {
  try {
    console.warn(JSON.stringify({ scope: 'clerk-auth', ...payload }));
  } catch {
    // intentional swallow — see comment above
  }
}

function errorClassName(err: unknown): string {
  return err instanceof Error ? err.constructor.name : 'NonError';
}

/**
 * `clerkAuth` middleware factory. Returns a Hono middleware that:
 *
 *   1. Extracts the Clerk session token from the request.
 *   2. Validates it against the Clerk Backend API using the Worker's
 *      `CLERK_SECRET_KEY` binding.
 *   3. On success, writes the Clerk subject id (`sub`) into
 *      `c.var.clerkSubjectId` and calls `next()`.
 *   4. On any failure, returns `401 UNAUTHENTICATED` with the canonical
 *      error envelope — no stack trace, no internal class name — and
 *      emits one `console.warn` carrying the structured reason so
 *      operators can distinguish missing-cookie from expired-token from
 *      wrong-issuer without re-instrumenting in prod.
 *
 * Concrete failure paths mapped to the same envelope:
 *
 *   - Missing token (no cookie, no bearer) → `reason: 'no-token'`.
 *   - `verifyToken` throws (transport-layer fault, runtime exception,
 *     etc.) OR returns an `{ errors }` envelope (expired token, wrong
 *     signature, malformed payload) → `reason: 'verify-threw'`.
 *   - Token verifies but the payload has no usable `sub` claim →
 *     `reason: 'no-subject'`.
 *
 * The `try/catch` around `verifyToken` is defence-in-depth even though
 * `@clerk/backend@^3` returns errors via the envelope rather than
 * throwing: a transport-layer fault (DNS, TLS, runtime polyfill drift)
 * still reaches the middleware as an unhandled rejection and would
 * otherwise surface as an opaque 500 instead of the canonical 401.
 * Discovered in production via PR #940's manual-QA walkthrough — see
 * Story #941.
 */
export function clerkAuth(): MiddlewareHandler<ClerkAuthEnv> {
  return async (c, next) => {
    const token = extractToken(c.req.raw);
    if (!token) {
      logAuthWarn({ reason: 'no-token' });
      return c.json(unauthenticated('Authentication required.'), 401);
    }

    const secretKey = c.env.CLERK_SECRET_KEY;
    if (!secretKey) {
      // Misconfiguration — the binding is required at deploy time. We
      // still surface 401 (never echo internal config state to the
      // caller); the binding's absence will already have failed the
      // deploy precheck. Logged as `no-token` because, from the
      // caller's perspective, the credential could not be validated.
      logAuthWarn({ reason: 'no-token' });
      return c.json(unauthenticated('Authentication required.'), 401);
    }

    let verification: Awaited<ReturnType<typeof verifyToken>>;
    try {
      verification = await verifyToken(token, { secretKey });
    } catch (err) {
      logAuthWarn({ reason: 'verify-threw', errorClass: errorClassName(err) });
      return c.json(unauthenticated('Authentication required.'), 401);
    }

    const errors = verification.errors as readonly unknown[] | undefined | null;
    if (errors !== undefined && errors !== null) {
      // v3 envelope contract: `errors` is a one-element tuple. We only
      // surface the first error's class name in the log payload; the
      // wire response always collapses to the canonical envelope so the
      // class name never leaks beyond Workers tail logs.
      const firstError = errors[0];
      logAuthWarn({ reason: 'verify-threw', errorClass: errorClassName(firstError) });
      return c.json(unauthenticated('Authentication required.'), 401);
    }

    const payload = verification.data as { sub?: unknown } | undefined;
    const subject = typeof payload?.sub === 'string' ? payload.sub : '';
    if (subject.length === 0) {
      logAuthWarn({ reason: 'no-subject' });
      return c.json(unauthenticated('Authentication required.'), 401);
    }

    c.set('clerkSubjectId', subject);
    await next();
    return undefined;
  };
}

// ---------------------------------------------------------------------------
// requireInternalUser — JIT users-row resolution (Task #343)
// ---------------------------------------------------------------------------

/**
 * Internal `AuthContext` attached to `c.var.auth` after `requireInternalUser`
 * runs. Routes downstream read this object instead of the raw Clerk subject.
 *
 * Per Tech Spec #318 §D this shape feeds the RBAC `canPerform()` policy.
 */
export interface AuthContext {
  readonly userId: string;
  readonly clerkSubjectId: string;
  readonly email: string;
  readonly role: string;
  readonly orgId: string | null;
  readonly teamId: string | null;
}

interface RequireInternalUserVariables extends ClerkAuthVariables {
  db: InternalUserDb;
  auth: AuthContext;
}

export type RequireInternalUserEnv = {
  Bindings: Env;
  Variables: RequireInternalUserVariables;
};

/**
 * Marker type for the Drizzle handle this middleware consumes.
 *
 * `unknown` is **deliberate**, not a placeholder waiting to be tightened.
 * The middleware is intentionally driver-agnostic: in contract tests the
 * handle is a `better-sqlite3` Drizzle proxy (the in-memory ephemeral
 * DB returned by `freshDb()`), while in production it is an
 * `@libsql/client` Drizzle proxy bound to a Turso/libSQL endpoint from
 * the Cloudflare Worker. The two driver flavours expose the same
 * fluent `select() / insert() / .onConflictDoNothing() / .returning()`
 * surface this file uses, but their full TypeScript types differ
 * across driver/builder versions in ways that cannot be expressed as a
 * single union without dragging both packages' types into every
 * consumer.
 *
 * Carrying the handle as `unknown` keeps the boundary honest — the
 * call sites in `lookupBySubject` / `insertIfAbsent` narrow the handle
 * structurally to the precise methods they invoke (`select`, `insert`,
 * `.values()`, `.onConflictDoNothing()`, `.returning()`, `.all()`),
 * which **self-documents** the contract this middleware actually
 * depends on. A `BetterSqliteDb | LibsqlDb` union would be both
 * unmanageable (it changes when either driver bumps minor) and less
 * informative than the inline structural narrowing.
 *
 * Production wiring (the `@libsql/client`-for-Workers adapter, paired
 * with the `better-sqlite3` Drizzle proxy in contract tests) lands with
 * the API-shell Story; this Task only ships the middleware that
 * consumes whatever handle the upstream provides.
 */
type InternalUserDb = unknown;

/**
 * Single source of truth for the JIT user-provisioning policy.
 *
 * Consolidates the three previously-scattered defaults — baseline role,
 * synthetic placeholder email format, and onboarding-timestamp seed —
 * into one named constant so a future maintainer can read the JIT
 * contract in one place rather than reconstructing it from a module-
 * scope `JIT_DEFAULT_ROLE` and an inline template literal inside
 * `buildJitCandidate`.
 *
 * Fields:
 *
 *   - `role`            Baseline role for every newly provisioned user.
 *                       `member` is the no-privilege baseline; per
 *                       `.agents/rules/security-baseline.md` (Authorization,
 *                       Forbidden Practices) there is no fallback secret,
 *                       no implicit role escalation, and no client-asserted
 *                       role on first-touch.
 *   - `syntheticEmail`  Placeholder email written on first JIT insert.
 *                       On first touch the middleware only has the opaque
 *                       Clerk subject id; the real address is populated by
 *                       the onboarding flow, which `UPDATE`s the row before
 *                       it is ever exposed to a client. The value is
 *                       internal and never logged (the redactor scrubs
 *                       `email`).
 *
 * Frozen via `as const` so the literal types flow into `JitCandidate`
 * and downstream tests, and so no caller can mutate the policy at
 * runtime.
 *
 * Note: the JIT insert writes `onboardedAt: null` inline (see
 * `insertIfAbsent`) rather than via a constant on `JIT_DEFAULTS` because
 * the lint-baseline sentinel rule (Story #555, Task #570) forbids
 * `.onboardedAt` reads outside the sanctioned `getOnboardingState`
 * accessor. The insert is a *write*, not a read.
 */
const JIT_DEFAULTS = {
  role: 'member',
  syntheticEmail: (clerkSubjectId: string) => `${clerkSubjectId}@clerk-jit.invalid`,
} as const;

interface JitCandidate {
  readonly id: string;
  readonly clerkSubjectId: string;
  readonly email: string;
  readonly role: string;
}

/**
 * Build the row we would insert for a brand-new Clerk subject. Pulled
 * out so the test surface can stub the id/email producers without
 * duplicating insert logic.
 */
function buildJitCandidate(clerkSubjectId: string): JitCandidate {
  return {
    id: `u_${crypto.randomUUID()}`,
    clerkSubjectId,
    email: JIT_DEFAULTS.syntheticEmail(clerkSubjectId),
    role: JIT_DEFAULTS.role,
  };
}

function toAuthContext(row: typeof users.$inferSelect): AuthContext {
  return {
    userId: row.id,
    clerkSubjectId: row.clerkSubjectId,
    email: row.email,
    role: row.role,
    orgId: row.orgId ?? null,
    teamId: row.teamId ?? null,
  };
}

/**
 * `requireInternalUser` middleware. Runs after `clerkAuth` on `/api/v1/*`
 * routes and converts the validated Clerk subject id into a row in the
 * production `users` table, JIT-inserting on first touch.
 *
 * Race elimination (Tech Spec #318 §C):
 *
 *   1. SELECT users WHERE clerk_subject_id = :sub LIMIT 1
 *      — fast path: row already exists.
 *   2. If missing, INSERT … ON CONFLICT(clerk_subject_id) DO NOTHING
 *      RETURNING *. A parallel inserter for the same subject hits the
 *      conflict path and RETURNING is empty for the loser.
 *   3. If RETURNING is empty (conflict path), re-SELECT to pick up the
 *      row the winner inserted.
 *
 * Net effect: under n parallel first-touch requests for one Clerk
 * subject, exactly one row exists in `users` and every request
 * succeeds with the same `userId`. No `SQLITE_CONSTRAINT` surfaces to
 * the caller.
 *
 * Reads `c.var.db` (the request-scoped Drizzle handle, set by an
 * upstream middleware in production and by `createTestApp(db, …)` in
 * contract tests) and `c.var.clerkSubjectId` (set by `clerkAuth`).
 */
export function requireInternalUser(): MiddlewareHandler<RequireInternalUserEnv> {
  return async (c, next) => {
    const clerkSubjectId = c.get('clerkSubjectId');
    if (!clerkSubjectId) {
      // Defensive: this middleware MUST be mounted after `clerkAuth`.
      // If we reach here without a subject, treat the request as
      // unauthenticated rather than crashing or leaking detail.
      return c.json(unauthenticated('Authentication required.'), 401);
    }

    const db: InternalUserDb = c.get('db');
    if (!db) {
      // Misconfiguration — DB binding missing. Surface 401 (never echo
      // internal config state).
      return c.json(unauthenticated('Authentication required.'), 401);
    }

    // Step 1 — fast path: row already exists.
    const existing = lookupBySubject(db, clerkSubjectId);
    if (existing) {
      c.set('auth', toAuthContext(existing));
      await next();
      return undefined;
    }

    // Step 2 — JIT insert with ON CONFLICT DO NOTHING RETURNING *.
    const candidate = buildJitCandidate(clerkSubjectId);
    const inserted = insertIfAbsent(db, candidate);
    if (inserted) {
      c.set('auth', toAuthContext(inserted));
      await next();
      return undefined;
    }

    // Step 3 — conflict path: a parallel request won. Re-select.
    const winner = lookupBySubject(db, clerkSubjectId);
    if (!winner) {
      // Unreachable in practice — ON CONFLICT means a row exists.
      // Surface 401 rather than echo an internal invariant violation.
      return c.json(unauthenticated('Authentication required.'), 401);
    }

    c.set('auth', toAuthContext(winner));
    await next();
    return undefined;
  };
}

function lookupBySubject(
  db: InternalUserDb,
  clerkSubjectId: string,
): typeof users.$inferSelect | null {
  // The middleware accepts any Drizzle SQLite flavour (better-sqlite3 in
  // tests, @libsql/client in production), so the query builder is bridged
  // structurally through `InternalUserDb` (typed as `unknown`) and
  // narrowed inline.
  const handle = db as { select: () => DrizzleSelectChain<typeof users.$inferSelect> };
  const rows = handle
    .select()
    .from(users)
    .where(eq(users.clerkSubjectId, clerkSubjectId))
    .limit(1)
    .all();
  return rows[0] ?? null;
}

function insertIfAbsent(
  db: InternalUserDb,
  candidate: JitCandidate,
): typeof users.$inferSelect | null {
  const handle = db as {
    insert: (table: unknown) => DrizzleInsertChain<typeof users.$inferSelect>;
  };
  const inserted = handle
    .insert(users)
    .values({
      id: candidate.id,
      clerkSubjectId: candidate.clerkSubjectId,
      email: candidate.email,
      role: candidate.role,
      // Inlined to `null` rather than `JIT_DEFAULTS.onboardedAt` because the
      // lint-baseline sentinel-pattern rule (Story #555, Task #570) forbids
      // `.onboardedAt` reads outside the sanctioned `getOnboardingState`
      // accessor. The constant value is the same; the inline write below
      // is a *write*, not a read, and falls outside the rule's scope.
      onboardedAt: null,
      // created_at / updated_at use schema defaults (unixepoch()).
    })
    .onConflictDoNothing({ target: users.clerkSubjectId })
    .returning()
    .all();
  return inserted[0] ?? null;
}
