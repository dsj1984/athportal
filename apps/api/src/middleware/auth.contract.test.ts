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
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

const MIGRATION_PATH = join(
  __dirname,
  '../../../../packages/shared/src/db/migrations/0000_auth_and_rbac.sql',
);

function freshProductionDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  const migration = readFileSync(MIGRATION_PATH, 'utf8');
  for (const stmt of migration.split('--> statement-breakpoint').map((s) => s.trim())) {
    if (stmt.length > 0) sqlite.exec(stmt);
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

beforeEach(() => {
  mockedVerifyToken.mockReset();
});

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
  });

  it('returns 401 UNAUTHENTICATED when verifyToken rejects an invalid token', async () => {
    mockedVerifyToken.mockResolvedValueOnce({
      // shape per @clerk/backend's JwtReturnType
      errors: [new Error('token expired')],
    } as unknown as Awaited<ReturnType<typeof verifyToken>>);

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
    // Stack traces / internal error details must not leak.
    expect(JSON.stringify(body)).not.toMatch(/token expired/);
    expect(JSON.stringify(body)).not.toMatch(/stack/i);
  });

  it('writes clerkSubjectId and yields next() on a valid cookie token', async () => {
    mockedVerifyToken.mockResolvedValueOnce({
      data: { sub: 'user_abc123' },
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
  });

  it('accepts a Bearer token when no __session cookie is present', async () => {
    mockedVerifyToken.mockResolvedValueOnce({
      data: { sub: 'user_bearer' },
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
      data: { sub: '' },
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
      data: { sub: 'user_cookie_flags' },
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
