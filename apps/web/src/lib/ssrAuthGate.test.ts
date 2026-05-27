// apps/web/src/lib/ssrAuthGate.test.ts
//
// Unit tests for the SSR auth gates that protect `/dashboard` and the
// `/admin/*` surface. Story #952 / F1 + F4.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { type SsrAuthContext, requireAdminSsr, requireSignedIn } from './ssrAuthGate';

function makeContext(opts: {
  userId: string | null;
  cookieHeader?: string;
}): SsrAuthContext {
  return {
    locals: {
      auth: () => ({ userId: opts.userId }),
    },
    request: new Request('https://app.example.com/dashboard', {
      headers: opts.cookieHeader ? { cookie: opts.cookieHeader } : {},
    }),
    redirect(path: string, status?: number) {
      return new Response(null, {
        status: status ?? 302,
        headers: { Location: path },
      });
    },
  };
}

describe('requireSignedIn', () => {
  it('returns a 302 to /sign-in when userId is null', () => {
    const ctx = makeContext({ userId: null });

    const result = requireSignedIn(ctx);

    expect(result).not.toBeNull();
    expect(result?.status).toBe(302);
    expect(result?.headers.get('Location')).toBe('/sign-in');
  });

  it('returns a 302 to /sign-in when userId is the empty string', () => {
    const ctx = makeContext({ userId: '' });

    const result = requireSignedIn(ctx);

    expect(result?.status).toBe(302);
    expect(result?.headers.get('Location')).toBe('/sign-in');
  });

  it('returns null when userId is a non-empty string', () => {
    const ctx = makeContext({ userId: 'user_test_abc' });

    expect(requireSignedIn(ctx)).toBeNull();
  });
});

describe('requireAdminSsr', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 302 /sign-in for anonymous callers without ever calling fetch', async () => {
    const fetchImpl = vi.fn();
    const ctx = makeContext({ userId: null });

    const result = await requireAdminSsr(ctx, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result?.status).toBe(302);
    expect(result?.headers.get('Location')).toBe('/sign-in');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns 404 when the admin probe returns 403 (signed-in non-admin)', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(new Response('forbidden', { status: 403 })));
    const ctx = makeContext({ userId: 'user_test_athlete', cookieHeader: '__session=abc' });

    const result = await requireAdminSsr(ctx, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result?.status).toBe(404);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('returns 404 when the admin probe returns any non-2xx', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(new Response('server error', { status: 500 })));
    const ctx = makeContext({ userId: 'user_test_abc' });

    const result = await requireAdminSsr(ctx, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result?.status).toBe(404);
  });

  it('returns 404 when the admin probe throws (network error)', async () => {
    const fetchImpl = vi.fn(() => Promise.reject(new TypeError('econnrefused')));
    const ctx = makeContext({ userId: 'user_test_abc' });

    const result = await requireAdminSsr(ctx, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result?.status).toBe(404);
  });

  it('returns null when the admin probe returns 2xx (signed-in admin)', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(new Response('{"rows":[]}', { status: 200 })));
    const ctx = makeContext({ userId: 'user_test_admin' });

    const result = await requireAdminSsr(ctx, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result).toBeNull();
  });

  it('forwards the request cookie header to the admin probe', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(new Response('{"rows":[]}', { status: 200 })));
    const ctx = makeContext({
      userId: 'user_test_admin',
      cookieHeader: '__session_abc=signed-jwt',
    });

    await requireAdminSsr(ctx, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const calls = fetchImpl.mock.calls as unknown as Array<
      [string, { headers: Record<string, string> }]
    >;
    expect(calls[0]?.[0]).toContain('/api/v1/admin/teams');
    expect(calls[0]?.[1].headers.cookie).toBe('__session_abc=signed-jwt');
  });

  it('uses the apiBaseUrl override when provided', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(new Response('{"rows":[]}', { status: 200 })));
    const ctx = makeContext({ userId: 'user_test_admin' });

    await requireAdminSsr(ctx, {
      apiBaseUrl: 'https://api.example.com',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.example.com/api/v1/admin/teams',
      expect.anything(),
    );
  });
});
