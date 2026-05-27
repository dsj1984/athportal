// apps/api/src/middleware/auth.contract.test.ts
//
// Contract test for the `clerkAuth` middleware (Story #330, Task #341).
//
// Asserts the wire-level guarantees of the Clerk JWT validator:
//
//   1. Anonymous requests (no cookie, no bearer) → 401 with the
//      canonical UNAUTHENTICATED error envelope.
//   2. Requests with an invalid token (verifyToken rejects) → 401 with
//      the same envelope and no stack trace, no internal class name.
//   3. Requests with a valid token → next() runs and `c.var.clerkSubjectId`
//      carries the Clerk subject id (`sub` claim).
//
// Tier: contract. We assert HTTP status codes, response-body shape, and
// the variable handed off to downstream middleware — exactly the surface
// docs/testing-strategy.md scopes to the contract tier. The deeper
// JIT-race and cookie-flag suite is owned by Task #346.

import { Hono } from 'hono';
import { type MockInstance, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock `@clerk/backend` so contract tests never touch the network. The
// mock is hoisted by vitest before the module under test loads.
vi.mock('@clerk/backend', () => ({
  verifyToken: vi.fn(),
}));

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { verifyToken } from '@clerk/backend';
import { users } from '@repo/shared/db/schema';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import {
  type AuthContext,
  type ClerkAuthEnv,
  type RequireInternalUserEnv,
  clerkAuth,
  requireInternalUser,
} from './auth';

const mockedVerifyToken = vi.mocked(verifyToken);

const MIGRATIONS_DIR = join(__dirname, '../../../../packages/shared/src/db/migrations');
const MIGRATION_FILES = [
  '0000_auth_and_rbac.sql',
  '0001_onboarding_schema.sql',
  '0002_org_team_graph.sql',
  '0003_invitations.sql',
  '0004_org_branding.sql',
];

function freshProductionDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  for (const file of MIGRATION_FILES) {
    const migration = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    for (const stmt of migration.split('--> statement-breakpoint').map((s) => s.trim())) {
      if (stmt.length > 0) sqlite.exec(stmt);
    }
  }
  return drizzle(sqlite, { schema: { users } });
}

function createApp(): Hono<ClerkAuthEnv> {
  const app = new Hono<ClerkAuthEnv>();
  app.use('*', clerkAuth());
  app.get('/echo', (c) => c.json({ subject: c.get('clerkSubjectId') }));
  return app;
}

const env = {
  CLERK_SECRET_KEY: 'sk_test_unit',
  CLERK_PUBLISHABLE_KEY: 'pk_test_unit',
  ANALYTICS: { writeDataPoint: () => {} },
};

/**
 * Capture every `console.warn` invocation. The middleware emits one
 * structured warn per 401 path; tests below assert the JSON envelope
 * shape AND the absence of any secret material in the captured output.
 */
type ConsoleWarn = (typeof console)['warn'];
let warnSpy: MockInstance<ConsoleWarn>;

beforeEach(() => {
  mockedVerifyToken.mockReset();
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  // `vi.spyOn` reuses the existing spy on a property that has already
  // been spied this run, so `mock.calls` carries over across tests
  // unless explicitly cleared. Clear so each test sees only its own
  // structured-warn output.
  warnSpy.mockClear();
});

/**
 * Decode every captured `console.warn` payload back to its JSON object.
 * The middleware always emits a single JSON string per call (see
 * `logAuthWarn` in auth.ts); anything that fails to parse fails the
 * test rather than being silently dropped.
 */
function capturedWarnPayloads(): Array<Record<string, unknown>> {
  return warnSpy.mock.calls.map((args) => {
    const raw: unknown = args[0];
    if (typeof raw !== 'string') {
      throw new Error(`expected JSON string from logAuthWarn, got ${typeof raw}`);
    }
    return JSON.parse(raw) as Record<string, unknown>;
  });
}

describe('clerkAuth middleware', () => {
  it('returns 401 UNAUTHENTICATED for anonymous requests', async () => {
    const app = createApp();

    const res = await app.request('/echo', { method: 'GET' }, env);

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      success: false,
      error: { code: 'UNAUTHENTICATED', message: 'Authentication required.' },
    });
    expect(mockedVerifyToken).not.toHaveBeenCalled();

    // Structured warn: anonymous request → reason 'no-token'.
    const payloads = capturedWarnPayloads();
    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toEqual({ scope: 'clerk-auth', reason: 'no-token' });
  });

  it('returns 401 UNAUTHENTICATED when verifyToken throws (expired token, wrong signature, etc.)', async () => {
    // @clerk/backend@^3 exports verifyToken wrapped in `withLegacyReturn`,
    // which converts the internal `{ data, errors }` envelope into "return
    // JwtPayload directly OR throw the first error". Every rejected-token
    // path therefore surfaces here as a thrown rejection — this is the
    // load-bearing case Story #941 fixed.
    class TokenExpiredError extends Error {
      constructor() {
        super('token expired');
        this.name = 'TokenExpiredError';
      }
    }
    mockedVerifyToken.mockRejectedValueOnce(new TokenExpiredError());

    const app = createApp();

    const res = await app.request(
      '/echo',
      {
        method: 'GET',
        headers: { cookie: '__session=bad-token' },
      },
      env,
    );

    expect(res.status).toBe(401);
    const body = (await res.json()) as unknown;
    expect(body).toEqual({
      success: false,
      error: { code: 'UNAUTHENTICATED', message: 'Authentication required.' },
    });
    // Stack traces / internal error details must not leak via the wire.
    expect(JSON.stringify(body)).not.toMatch(/token expired/);
    expect(JSON.stringify(body)).not.toMatch(/stack/i);

    // Structured warn: rejected token → reason 'verify-threw' with the
    // constructor name of the thrown error. Token MUST NOT leak.
    const payloads = capturedWarnPayloads();
    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toEqual({
      scope: 'clerk-auth',
      reason: 'verify-threw',
      errorClass: 'TokenExpiredError',
    });
    expect(JSON.stringify(payloads[0])).not.toMatch(/bad-token/);
    expect(JSON.stringify(payloads[0])).not.toMatch(/sk_test_unit/);
  });

  it('returns 401 UNAUTHENTICATED when verifyToken throws a transport-layer fault', async () => {
    // DNS / TLS / runtime polyfill drift also surface as thrown
    // rejections rather than envelope errors. Same 401 + structured
    // warn discipline.
    class FetchFailedError extends Error {
      constructor() {
        super('upstream fetch failed');
        this.name = 'FetchFailedError';
      }
    }
    mockedVerifyToken.mockRejectedValueOnce(new FetchFailedError());

    const app = createApp();

    const res = await app.request(
      '/echo',
      {
        method: 'GET',
        headers: { cookie: '__session=will-throw' },
      },
      env,
    );

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      success: false,
      error: { code: 'UNAUTHENTICATED', message: 'Authentication required.' },
    });

    const payloads = capturedWarnPayloads();
    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toEqual({
      scope: 'clerk-auth',
      reason: 'verify-threw',
      errorClass: 'FetchFailedError',
    });
    expect(JSON.stringify(payloads[0])).not.toMatch(/will-throw/);
    expect(JSON.stringify(payloads[0])).not.toMatch(/sk_test_unit/);
  });

  it('writes clerkSubjectId and yields next() on a valid cookie token', async () => {
    // v3 surface: verifyToken returns the JwtPayload directly (not
    // a `{ data, errors }` envelope), per `withLegacyReturn` wrapping
    // at the public export. See Story #941.
    mockedVerifyToken.mockResolvedValueOnce({
      sub: 'user_abc123',
    } as unknown as Awaited<ReturnType<typeof verifyToken>>);

    const app = createApp();

    const res = await app.request(
      '/echo',
      {
        method: 'GET',
        headers: { cookie: 'other=1; __session=good-token; trailing=2' },
      },
      env,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ subject: 'user_abc123' });
    expect(mockedVerifyToken).toHaveBeenCalledTimes(1);
    expect(mockedVerifyToken).toHaveBeenCalledWith('good-token', {
      secretKey: 'sk_test_unit',
    });

    // Happy path: no structured warn fires.
    expect(capturedWarnPayloads()).toHaveLength(0);
  });

  it('accepts a Bearer token when no __session cookie is present', async () => {
    mockedVerifyToken.mockResolvedValueOnce({
      sub: 'user_bearer',
    } as unknown as Awaited<ReturnType<typeof verifyToken>>);

    const app = createApp();

    const res = await app.request(
      '/echo',
      {
        method: 'GET',
        headers: { authorization: 'Bearer raw-token' },
      },
      env,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ subject: 'user_bearer' });
    expect(mockedVerifyToken).toHaveBeenCalledWith('raw-token', {
      secretKey: 'sk_test_unit',
    });
  });

  it('rejects a verified token that carries an empty sub claim', async () => {
    mockedVerifyToken.mockResolvedValueOnce({
      sub: '',
    } as unknown as Awaited<ReturnType<typeof verifyToken>>);

    const app = createApp();

    const res = await app.request(
      '/echo',
      { method: 'GET', headers: { cookie: '__session=tok' } },
      env,
    );

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({
      success: false,
      error: { code: 'UNAUTHENTICATED' },
    });

    // Structured warn: empty sub claim → reason 'no-subject'.
    const payloads = capturedWarnPayloads();
    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toEqual({ scope: 'clerk-auth', reason: 'no-subject' });
  });
});

// ---------------------------------------------------------------------------
// requireInternalUser (Task #343) — JIT lookup / insert / re-select.
// ---------------------------------------------------------------------------

function createJitApp(db: ReturnType<typeof freshProductionDb>, subjectId: string) {
  const app = new Hono<RequireInternalUserEnv>();
  app.use('*', async (c, next) => {
    c.set('db', db);
    c.set('clerkSubjectId', subjectId);
    await next();
  });
  app.use('*', requireInternalUser());
  app.get('/echo', (c) => {
    const auth: AuthContext = c.get('auth');
    return c.json(auth);
  });
  return app;
}

describe('requireInternalUser middleware', () => {
  it('JIT-inserts a row for an unknown Clerk subject and attaches AuthContext', async () => {
    const db = freshProductionDb();
    const subject = 'user_jit_first_touch';
    const app = createJitApp(db, subject);

    const res = await app.request('/echo', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as AuthContext;
    expect(body.clerkSubjectId).toBe(subject);
    expect(body.role).toBe('member');
    expect(body.userId).toMatch(/^u_/);

    // Exactly one row exists.
    const rows = db.select().from(users).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.clerkSubjectId).toBe(subject);
  });

  it('reads an existing user without inserting', async () => {
    const db = freshProductionDb();
    const subject = 'user_existing';
    // Pre-seed.
    db.insert(users)
      .values({
        id: 'u_pre',
        clerkSubjectId: subject,
        email: 'pre@example.invalid',
        role: 'org_admin',
      })
      .run();

    const app = createJitApp(db, subject);
    const res = await app.request('/echo', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as AuthContext;
    expect(body.userId).toBe('u_pre');
    expect(body.role).toBe('org_admin');

    const rows = db.select().from(users).all();
    expect(rows).toHaveLength(1);
  });

  it('produces exactly one row under n=8 parallel first-touch requests', async () => {
    const db = freshProductionDb();
    const subject = 'user_race_target';
    const app = createJitApp(db, subject);

    const N = 8;
    const settled = await Promise.all(
      Array.from({ length: N }, async () => app.request('/echo', { method: 'GET' })),
    );

    // All responses succeeded.
    for (const res of settled) {
      expect(res.status).toBe(200);
    }
    const bodies = (await Promise.all(settled.map((r) => r.json()))) as AuthContext[];

    // All point at the same internal userId.
    const ids = new Set(bodies.map((b) => b.userId));
    expect(ids.size).toBe(1);

    // Exactly one row in users.
    const rows = db.select().from(users).where(eqSubjectFilter(subject)).all();
    expect(rows).toHaveLength(1);

    // No SQLITE_CONSTRAINT propagated (the fact that every res is 200
    // already implies this, but spell it out).
    const totalRows = db.select().from(users).all();
    expect(totalRows).toHaveLength(1);
  });

  it('returns 401 UNAUTHENTICATED when DB binding is missing', async () => {
    const app = new Hono<RequireInternalUserEnv>();
    app.use('*', async (c, next) => {
      c.set('clerkSubjectId', 'user_dbless');
      await next();
    });
    app.use('*', requireInternalUser());
    app.get('/echo', (c) => c.json({ ok: true }));

    const res = await app.request('/echo', { method: 'GET' });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({
      success: false,
      error: { code: 'UNAUTHENTICATED' },
    });
  });
});

// Tiny helper — keeps the parallel-first-touch test free of the
// drizzle-orm import shuffle inline.
import { eq } from 'drizzle-orm';
function eqSubjectFilter(subject: string) {
  return eq(users.clerkSubjectId, subject);
}

// ---------------------------------------------------------------------------
// Task #346 — Anonymous-route sweep + session cookie security flags
// ---------------------------------------------------------------------------
//
// Tasks #341/#343/#344 each shipped their own contract assertions
// alongside the code under test. Task #346 is the security-critical
// gate: every protected route refuses anonymous callers with the same
// envelope, and any `Set-Cookie` our server emits for `__session`
// carries `HttpOnly` + `Secure` + `SameSite=Lax`.
//
// The sweep iterates the route table so adding a new `/api/v1/*` route
// without auth coverage becomes a review-time miss (the sweep would
// not exercise it). When a new protected route is added, append it
// here.

import { meRoute } from '../routes/v1/me';
import { signOutRoute } from '../routes/v1/sign-out';

interface ProtectedRoute {
  readonly path: string;
  readonly method: 'GET' | 'POST';
  readonly mountWith: (app: Hono<RequireInternalUserEnv>) => void;
}

const PROTECTED_ROUTES: readonly ProtectedRoute[] = [
  {
    path: '/api/v1/me',
    method: 'GET',
    mountWith: (app) => app.route('/api/v1/me', meRoute),
  },
  {
    path: '/api/v1/sign-out',
    method: 'POST',
    mountWith: (app) => app.route('/api/v1/sign-out', signOutRoute),
  },
];

function buildProtectedApp(
  db: ReturnType<typeof freshProductionDb>,
  mount: ProtectedRoute['mountWith'],
) {
  const app = new Hono<RequireInternalUserEnv>();
  app.use('*', async (c, next) => {
    c.set('db', db);
    await next();
  });
  app.use('*', clerkAuth());
  app.use('*', requireInternalUser());
  mount(app);
  return app;
}

describe('Anonymous-route sweep across /api/v1/* (Task #346)', () => {
  for (const route of PROTECTED_ROUTES) {
    it(`${route.method} ${route.path} returns 401 UNAUTHENTICATED for anonymous callers`, async () => {
      const app = buildProtectedApp(freshProductionDb(), route.mountWith);
      const res = await app.request(route.path, { method: route.method }, env);

      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({
        success: false,
        error: { code: 'UNAUTHENTICATED' },
      });
    });
  }
});

describe('Session cookie security flags (Task #346)', () => {
  it('Set-Cookie issued on a fresh sign-in flow carries HttpOnly + Secure + SameSite=Lax', async () => {
    // Our API does not issue the Clerk `__session` cookie itself — Clerk's
    // hosted sign-in flow does. The only `Set-Cookie` our routes emit is
    // the sign-out clear, which MUST mirror Clerk's issuance flags so a
    // downgraded re-issue is impossible. Asserting this header on the
    // sign-out path is the contract gate for the cookie-flag posture
    // (Tech Spec #318 §Security, security-baseline §"Transport & Headers").
    mockedVerifyToken.mockResolvedValueOnce({
      sub: 'user_cookie_flags',
    } as unknown as Awaited<ReturnType<typeof verifyToken>>);

    const app = buildProtectedApp(freshProductionDb(), (a) =>
      a.route('/api/v1/sign-out', signOutRoute),
    );

    const res = await app.request(
      '/api/v1/sign-out',
      { method: 'POST', headers: { cookie: '__session=valid' } },
      env,
    );

    expect(res.status).toBe(204);
    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).not.toBeNull();
    expect(setCookie).toMatch(/^__session=/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/Secure/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
  });
});
