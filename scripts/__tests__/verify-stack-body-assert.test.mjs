// scripts/__tests__/verify-stack-body-assert.test.mjs
//
// Unit tests for the assertBodyContains and assertLocationContains features
// added to scripts/smoke/verify-stack.mjs (Story #1008).
//
// Pyramid tier: unit. The `probe` function is tested in isolation by
// replacing the global `fetch` with a stub so no network I/O occurs.
//
// Invariants pinned here:
//
//   assertBodyContains:
//   1. When `assertBodyContains` is absent the probe returns ok when the
//      status matches, without issuing a body-check fetch.
//   2. When `assertBodyContains` is present and the redirect-following
//      response body contains the needle, the probe returns ok.
//   3. When `assertBodyContains` is present and the body does NOT contain
//      the needle, the probe returns ok=false with a diagnostic detail
//      message.
//   4. When the body-check fetch itself throws a network error, the probe
//      returns ok=false with a descriptive detail message.
//   5. The status-check runs first; a status mismatch short-circuits before
//      the body-check fetch is issued.
//
//   assertLocationContains:
//   6. When `assertLocationContains` is present and the Location header
//      contains the needle, the probe returns ok (no second fetch issued).
//   7. When `assertLocationContains` is present and the Location header
//      does NOT contain the needle, the probe returns ok=false.
//   8. When the Location header is absent, the probe returns ok=false.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { probe } from '../smoke/verify-stack.mjs';

// ---------------------------------------------------------------------------
// Stub helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal Response-like object sufficient for the probe function.
 * `locationHeader` is only relevant for redirect (3xx) responses where
 * `assertLocationContains` checks the `Location` header.
 */
function makeResponse(status, bodyText = '', locationHeader = null) {
  return {
    status,
    text: () => Promise.resolve(bodyText),
    headers: {
      get: (name) => (name.toLowerCase() === 'location' ? locationHeader : null),
    },
  };
}

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

describe('probe — assertBodyContains absent', () => {
  beforeEach(() => {
    // Invariant 1: only the manual-redirect fetch is issued.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeResponse(200, '<html>hello</html>')));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns ok=true when status matches and no assertBodyContains set', async () => {
    const entry = { path: '/sign-in', method: 'GET', expectedStatus: 200 };
    const result = await probe('http://localhost:4321', entry);
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.detail).toBeNull();
    // Only one fetch call — no body-check second fetch.
    expect(fetch).toHaveBeenCalledTimes(1);
    const [, init] = fetch.mock.calls[0];
    expect(init.redirect).toBe('manual');
  });

  it('returns ok=false when status does not match', async () => {
    // The mock returns 200 but we expect 302 — status mismatch.
    const entry = { path: '/missing', method: 'GET', expectedStatus: 302 };
    const result = await probe('http://localhost:4321', entry);
    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/expected 302, got/);
    // Status short-circuit — still only one fetch call.
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('probe — assertBodyContains present, body matches', () => {
  beforeEach(() => {
    // Invariant 2: two fetches, second follows redirects, body contains needle.
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        // First call: manual-redirect status check (302).
        .mockResolvedValueOnce(makeResponse(302, ''))
        // Second call: redirect-following body fetch.
        .mockResolvedValueOnce(
          makeResponse(200, '<div data-testid="dashboard-roster-team">roster</div>'),
        ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns ok=true when redirect-followed body contains the needle', async () => {
    const entry = {
      path: '/dev/sign-in-as/coach',
      method: 'GET',
      expectedStatus: 302,
      assertBodyContains: 'data-testid="dashboard-roster-team"',
    };
    const result = await probe('http://localhost:4321', entry);
    expect(result.ok).toBe(true);
    expect(result.status).toBe(302);
    expect(result.detail).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
    const [, firstInit] = fetch.mock.calls[0];
    const [, secondInit] = fetch.mock.calls[1];
    expect(firstInit.redirect).toBe('manual');
    expect(secondInit.redirect).toBe('follow');
  });
});

describe('probe — assertBodyContains present, body does NOT match', () => {
  beforeEach(() => {
    // Invariant 3: two fetches; body missing the needle → ok=false.
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(makeResponse(302, ''))
        .mockResolvedValueOnce(makeResponse(200, '<html>sign-in page</html>')),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns ok=false with a diagnostic detail when needle is absent from body', async () => {
    const entry = {
      path: '/dev/sign-in-as/coach',
      method: 'GET',
      expectedStatus: 302,
      assertBodyContains: 'data-testid="dashboard-roster-team"',
    };
    const result = await probe('http://localhost:4321', entry);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(302);
    expect(result.detail).toMatch(/assertBodyContains failed/);
    expect(result.detail).toContain('dashboard-roster-team');
  });
});

describe('probe — assertBodyContains present, body-check fetch throws', () => {
  beforeEach(() => {
    // Invariant 4: first fetch succeeds (302), second throws.
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(makeResponse(302, ''))
        .mockRejectedValueOnce(new Error('ECONNREFUSED')),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns ok=false with a network error detail when body-check fetch throws', async () => {
    const entry = {
      path: '/dev/sign-in-as/coach',
      method: 'GET',
      expectedStatus: 302,
      assertBodyContains: 'data-testid="dashboard-roster-team"',
    };
    const result = await probe('http://localhost:4321', entry);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(302);
    expect(result.detail).toMatch(/assertBodyContains fetch error/);
    expect(result.detail).toContain('ECONNREFUSED');
  });
});

describe('probe — assertBodyContains present, status mismatch short-circuits', () => {
  beforeEach(() => {
    // Invariant 5: only the first manual-redirect fetch is issued when
    // the status does not match; the body-check fetch must NOT be called.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(makeResponse(200, '<html>ok</html>')));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not issue body-check fetch when status does not match expected', async () => {
    const entry = {
      path: '/dev/sign-in-as/coach',
      method: 'GET',
      expectedStatus: 302,
      assertBodyContains: 'data-testid="dashboard-roster-team"',
    };
    const result = await probe('http://localhost:4321', entry);
    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/expected 302, got 200/);
    // Only one fetch call — body-check was not attempted.
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('probe — assertLocationContains present, Location header matches', () => {
  beforeEach(() => {
    // Invariant 6: single fetch; Location header contains the needle.
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          makeResponse(302, '', '/sign-in?__clerk_ticket=tok_abc&redirect_url=%2Fdashboard'),
        ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns ok=true without a second fetch when Location contains the needle', async () => {
    const entry = {
      path: '/dev/sign-in-as/coach',
      method: 'GET',
      expectedStatus: 302,
      assertLocationContains: '__clerk_ticket=',
    };
    const result = await probe('http://localhost:4321', entry);
    expect(result.ok).toBe(true);
    expect(result.status).toBe(302);
    expect(result.detail).toBeNull();
    // Only one fetch call — no body-check second fetch needed.
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('probe — assertLocationContains present, Location header does NOT match', () => {
  beforeEach(() => {
    // Invariant 7: 302 but Location is missing the needle.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(makeResponse(302, '', '/sign-in')),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns ok=false with a diagnostic detail when Location does not contain needle', async () => {
    const entry = {
      path: '/dev/sign-in-as/coach',
      method: 'GET',
      expectedStatus: 302,
      assertLocationContains: '__clerk_ticket=',
    };
    const result = await probe('http://localhost:4321', entry);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(302);
    expect(result.detail).toMatch(/assertLocationContains failed/);
    expect(result.detail).toContain('__clerk_ticket=');
  });
});

describe('probe — assertLocationContains present, Location header absent', () => {
  beforeEach(() => {
    // Invariant 8: 302 with no Location header at all.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(makeResponse(302, '', null)));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns ok=false when the Location header is absent', async () => {
    const entry = {
      path: '/dev/sign-in-as/coach',
      method: 'GET',
      expectedStatus: 302,
      assertLocationContains: '__clerk_ticket=',
    };
    const result = await probe('http://localhost:4321', entry);
    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/assertLocationContains failed/);
  });
});
