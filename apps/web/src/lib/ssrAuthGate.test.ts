// apps/web/src/lib/ssrAuthGate.test.ts
//
// Unit tests for the SSR auth gates that protect `/dashboard` and the
// `/admin/*` surface. Story #952 / F1 + F4. Extended by Story #1086
// with `isAdminBySsr` — the boolean org-admin probe `/dashboard` uses
// to route an org-admin to the admin landing.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { type SsrAuthContext, isAdminBySsr, requireAdminSsr, requireSignedIn } from './ssrAuthGate';

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

  it('appends an encoded redirect_url query param when returnTo is provided', () => {
    const ctx = makeContext({ userId: null });

    const result = requireSignedIn(ctx, { returnTo: '/onboarding' });

    expect(result?.status).toBe(302);
    expect(result?.headers.get('Location')).toBe('/sign-in?redirect_url=%2Fonboarding');
  });

  it('encodes returnTo paths that contain query strings', () => {
    const ctx = makeContext({ userId: null });

    const result = requireSignedIn(ctx, { returnTo: '/onboarding?invite=tok_abc' });

    expect(result?.headers.get('Location')).toBe(
      '/sign-in?redirect_url=%2Fonboarding%3Finvite%3Dtok_abc',
    );
  });

  it('ignores an empty returnTo string and emits a bare /sign-in redirect', () => {
    const ctx = makeContext({ userId: null });

    const result = requireSignedIn(ctx, { returnTo: '' });

    expect(result?.headers.get('Location')).toBe('/sign-in');
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

describe('isAdminBySsr (Story #1086)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns false for anonymous callers without ever calling fetch', async () => {
    const fetchImpl = vi.fn();
    const ctx = makeContext({ userId: null });

    const result = await isAdminBySsr(ctx, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns true when the admin probe returns 2xx (signed-in admin)', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(new Response('{"rows":[]}', { status: 200 })));
    const ctx = makeContext({ userId: 'user_test_admin' });

    const result = await isAdminBySsr(ctx, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result).toBe(true);
  });

  it('returns false when the admin probe returns 403 (signed-in non-admin)', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(new Response('forbidden', { status: 403 })));
    const ctx = makeContext({ userId: 'user_test_member', cookieHeader: '__session=abc' });

    const result = await isAdminBySsr(ctx, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result).toBe(false);
  });

  it('returns false when the admin probe throws (network error)', async () => {
    const fetchImpl = vi.fn(() => Promise.reject(new TypeError('econnrefused')));
    const ctx = makeContext({ userId: 'user_test_member' });

    const result = await isAdminBySsr(ctx, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result).toBe(false);
  });

  it('forwards the request cookie header to the admin probe', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(new Response('{"rows":[]}', { status: 200 })));
    const ctx = makeContext({
      userId: 'user_test_admin',
      cookieHeader: '__session_abc=signed-jwt',
    });

    await isAdminBySsr(ctx, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const calls = fetchImpl.mock.calls as unknown as Array<
      [string, { headers: Record<string, string> }]
    >;
    expect(calls[0]?.[0]).toContain('/api/v1/admin/teams');
    expect(calls[0]?.[1].headers.cookie).toBe('__session_abc=signed-jwt');
  });
});
