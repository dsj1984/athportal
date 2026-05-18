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

import { verifyToken } from '@clerk/backend';
import { type ClerkAuthEnv, clerkAuth } from './auth';

const mockedVerifyToken = vi.mocked(verifyToken);

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
    const body = await res.json();
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
