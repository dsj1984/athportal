// apps/web/src/pages/sign-out.contract.test.ts
//
// Contract test for `/sign-out`. Story #951 / F4. Pins three invariants
// that the prior shape silently violated:
//
//   1. Every Clerk-namespaced cookie present on the request is deleted —
//      not just the literal `__session`. Match the regex set in
//      `extractClerkCookieNames`.
//   2. The 303 redirect target is NOT `/` (which is a 404 route). Pin
//      `/sign-in` explicitly so a future change can't quietly regress.
//   3. Server-side revocation failure must emit a structured `warn` log,
//      not silently swallow.
//
// Strategy. F4's narrative says "mint a real Clerk session via
// `mintSignInTicket()` and exchange it for a session cookie". In
// practice the full ticket-exchange flow runs through Clerk's frontend
// SDK, which is not callable from a Node-side contract test without
// shipping a headless browser into the suite. Instead, we construct a
// `Request` carrying the cookie names a real Clerk dev session emits
// and assert the endpoint's response to it — same contract, no browser.
//
// Contract tier per `.agents/rules/testing-standards.md` — HTTP shape
// (status, Location header, cookies.delete() calls) lives here.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { POST, extractClerkCookieNames } from './sign-out';

// Hoisted mock so the factory and test bodies share the same handle.
const clerkMocks = vi.hoisted(() => ({
  revokeSession: vi.fn<(id: string) => Promise<unknown>>(),
}));

vi.mock('@clerk/astro/server', () => ({
  clerkClient: () => ({
    sessions: { revokeSession: clerkMocks.revokeSession },
  }),
}));

interface FakeCookies {
  deleted: Array<{ name: string; path?: string }>;
  delete(name: string, options?: { path?: string }): void;
}

function fakeCookies(): FakeCookies {
  const deleted: Array<{ name: string; path?: string }> = [];
  return {
    deleted,
    delete(name, options) {
      deleted.push({ name, ...(options?.path !== undefined ? { path: options.path } : {}) });
    },
  };
}

function fakeContext(opts: { cookieHeader: string | null; sessionId: string | null }): {
  ctx: Parameters<typeof POST>[0];
  cookies: FakeCookies;
  redirects: Array<{ path: string; status: number | undefined }>;
} {
  const cookies = fakeCookies();
  const redirects: Array<{ path: string; status: number | undefined }> = [];
  const request = new Request('https://app.example.com/sign-out', {
    method: 'POST',
    headers: opts.cookieHeader ? { cookie: opts.cookieHeader } : {},
  });
  const ctx = {
    locals: {
      auth: () => ({ sessionId: opts.sessionId }),
    },
    cookies,
    request,
    redirect(path: string, status?: number) {
      redirects.push({ path, status });
      const headers = new Headers({ Location: path });
      return new Response(null, { status: status ?? 302, headers });
    },
  } as unknown as Parameters<typeof POST>[0];
  return { ctx, cookies, redirects };
}

afterEach(() => {
  clerkMocks.revokeSession.mockReset();
});

describe('extractClerkCookieNames', () => {
  it('returns [] for a null or empty cookie header', () => {
    expect(extractClerkCookieNames(null)).toEqual([]);
    expect(extractClerkCookieNames('')).toEqual([]);
  });

  it('matches namespaced session/db-jwt/client-uat cookies', () => {
    const header =
      '__session_0NWIer_-=abc; __clerk_db_jwt_0NWIer_-=def; __client_uat_0NWIer_-=1700000000';
    const names = extractClerkCookieNames(header);
    expect(names).toEqual([
      '__session_0NWIer_-',
      '__clerk_db_jwt_0NWIer_-',
      '__client_uat_0NWIer_-',
    ]);
  });

  it('matches bare-literal forms alongside namespaced ones', () => {
    const header = '__session=abc; __clerk_db_jwt=def; __client_uat=1';
    const names = extractClerkCookieNames(header);
    expect(names).toEqual(['__session', '__clerk_db_jwt', '__client_uat']);
  });

  it('matches the stable clerk_active_context cookie', () => {
    expect(extractClerkCookieNames('clerk_active_context=org_abc')).toEqual([
      'clerk_active_context',
    ]);
  });

  it('ignores cookies that do not match any pattern', () => {
    const header = 'app_session=other; analytics_id=xyz; clerk_active_contexts=oops';
    expect(extractClerkCookieNames(header)).toEqual([]);
  });

  it('does not match cookies whose name merely contains a Clerk token', () => {
    // The patterns are anchored — `prefix__session` and `__sessionextra`
    // must NOT match, otherwise an attacker could shadow the delete by
    // picking a cookie name that the regex accidentally accepts.
    expect(extractClerkCookieNames('prefix__session=a; __sessionextra=b')).toEqual([]);
  });

  it('deduplicates repeated cookie names', () => {
    expect(extractClerkCookieNames('__session=a; __session=b')).toEqual(['__session']);
  });
});

describe('POST /sign-out — cookie cleanup', () => {
  it('deletes every Clerk-namespaced cookie present on the request', async () => {
    const { ctx, cookies } = fakeContext({
      cookieHeader:
        '__session_0NWIer_-=abc; __clerk_db_jwt_0NWIer_-=def; ' +
        '__client_uat_0NWIer_-=1700000000; clerk_active_context=org_abc; ' +
        'unrelated=keep',
      sessionId: null,
    });

    await POST(ctx);

    expect(cookies.deleted.map((d) => d.name).sort()).toEqual(
      [
        '__client_uat_0NWIer_-',
        '__clerk_db_jwt_0NWIer_-',
        '__session_0NWIer_-',
        'clerk_active_context',
      ].sort(),
    );
    // Unrelated cookies are NOT touched.
    expect(cookies.deleted.find((d) => d.name === 'unrelated')).toBeUndefined();
  });

  it('uses path: "/" on every delete so it matches Clerk\'s Set-Cookie scope', async () => {
    const { ctx, cookies } = fakeContext({
      cookieHeader: '__session=abc; __clerk_db_jwt=def',
      sessionId: null,
    });

    await POST(ctx);

    for (const del of cookies.deleted) {
      expect(del.path).toBe('/');
    }
  });

  it('is a no-op on the cookies when the request carries no Clerk cookies', async () => {
    const { ctx, cookies } = fakeContext({
      cookieHeader: 'unrelated=keep; tracker=xyz',
      sessionId: null,
    });

    await POST(ctx);

    expect(cookies.deleted).toEqual([]);
  });
});

describe('POST /sign-out — redirect target (F2)', () => {
  it('redirects to /sign-in (NOT the bare / 404 route) with status 303', async () => {
    const { ctx, redirects } = fakeContext({
      cookieHeader: '__session=abc',
      sessionId: null,
    });

    const res = await POST(ctx);

    expect(redirects).toEqual([{ path: '/sign-in', status: 303 }]);
    // Defensive: the response's Location header must NOT be `/`.
    expect(res.headers.get('Location')).not.toBe('/');
    expect(res.headers.get('Location')).toBe('/sign-in');
  });
});

describe('POST /sign-out — server-side revocation', () => {
  it('calls revokeSession when an auth session id is present', async () => {
    clerkMocks.revokeSession.mockResolvedValueOnce({});
    const { ctx } = fakeContext({
      cookieHeader: '__session=abc',
      sessionId: 'sess_test_123',
    });

    await POST(ctx);

    expect(clerkMocks.revokeSession).toHaveBeenCalledTimes(1);
    expect(clerkMocks.revokeSession).toHaveBeenCalledWith('sess_test_123');
  });

  it('does NOT call revokeSession when there is no session id', async () => {
    const { ctx } = fakeContext({
      cookieHeader: '__session=abc',
      sessionId: null,
    });

    await POST(ctx);

    expect(clerkMocks.revokeSession).not.toHaveBeenCalled();
  });

  it('F3: emits a structured warn log on revoke failure but still completes sign-out', async () => {
    clerkMocks.revokeSession.mockRejectedValueOnce(new TypeError('boom'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { ctx, cookies, redirects } = fakeContext({
      cookieHeader: '__session_0NWIer_-=abc',
      sessionId: 'sess_test_123',
    });

    try {
      const res = await POST(ctx);

      // Sign-out still completes: cookies cleared, redirect to /sign-in.
      expect(cookies.deleted.map((d) => d.name)).toEqual(['__session_0NWIer_-']);
      expect(redirects).toEqual([{ path: '/sign-in', status: 303 }]);
      expect(res.status).toBe(303);

      // And the warn payload is structured, names the event, names the
      // error class, and contains NEITHER the session id NOR the token.
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const calls = warnSpy.mock.calls as unknown as Array<[string]>;
      const arg = calls[0]?.[0];
      expect(typeof arg).toBe('string');
      const payload = JSON.parse(arg ?? '{}') as Record<string, unknown>;
      expect(payload.event).toBe('sign_out_revoke_failed');
      expect(payload.errorClass).toBe('TypeError');
      expect(JSON.stringify(payload)).not.toContain('sess_test_123');
    } finally {
      warnSpy.mockRestore();
    }
  });
});
