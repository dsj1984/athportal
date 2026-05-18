// apps/api/src/routes/debug/synthetic-failure.contract.test.ts
//
// Contract test for the synthetic-failure rehearsal route (Story #275, AC-4).
//
// Locks the invariants that the runbook rehearsal procedure depends on:
//
//   1. When OBSERVABILITY_SYNTHETIC_FAILURE_ENABLED is unset (or not the
//      literal string 'true'), every verb on the route returns 404 with
//      the standard 404 error envelope. The route MUST NOT respond with
//      403 — a 403 would disclose the route's existence to an
//      unauthenticated probe and defeat the "indistinguishable from a
//      non-existent route" contract in Tech Spec #246 § "Synthetic-failure
//      endpoint exposure surface".
//
//   2. When the flag is set to the literal string 'true', POST throws a
//      SyntheticFailureError. The thrown error is captured by the
//      `@sentry/cloudflare` `captureException` call exactly once, so the
//      rehearsal alert path is exercised end-to-end at the SDK boundary.
//
// Tier: contract. Assertions are wire shape (HTTP status, error envelope)
// and call-counts on the Sentry capture stub. The error class itself is
// imported through the same module under test only via the throw — the
// `SyntheticFailureError` constructor is module-private and the test
// MUST NOT instantiate it directly. See Story #275 § Critical invariants.

import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock hoists, so the stub captureException is in place before the
// route module's import side-effects run. The variable is reassigned in
// `beforeEach` so each test gets a fresh `vi.fn()` and the call counts
// do not leak between cases.
const captureExceptionMock = vi.fn();
vi.mock('@sentry/cloudflare', () => ({
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
}));

import { syntheticFailureRoute } from './synthetic-failure';

interface RouteEnv {
  OBSERVABILITY_SYNTHETIC_FAILURE_ENABLED?: string;
}

function createApp(): Hono<{ Bindings: RouteEnv }> {
  const app = new Hono<{ Bindings: RouteEnv }>();
  app.route('/api/v1/_debug/synthetic-failure', syntheticFailureRoute);
  return app;
}

beforeEach(() => {
  captureExceptionMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /api/v1/_debug/synthetic-failure — gate closed', () => {
  it('returns 404 when the env flag is unset', async () => {
    // Arrange
    const app = createApp();

    // Act
    const res = await app.request(
      '/api/v1/_debug/synthetic-failure',
      { method: 'POST' },
      {} satisfies RouteEnv,
    );

    // Assert — wire shape
    expect(res.status).toBe(404);
    expect(res.status).not.toBe(403);
    const body = await res.json();
    expect(body).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });

    // Assert — capture path not exercised
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it('returns 404 when the env flag is the literal string "false"', async () => {
    // Arrange — the gate accepts only the literal string 'true'; any other
    // value (including the truthy-looking 'false', '1', or 'TRUE') is the
    // closed state.
    const app = createApp();

    // Act
    const res = await app.request('/api/v1/_debug/synthetic-failure', { method: 'POST' }, {
      OBSERVABILITY_SYNTHETIC_FAILURE_ENABLED: 'false',
    } satisfies RouteEnv);

    // Assert
    expect(res.status).toBe(404);
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it('returns 404 on GET (unsupported verb) when the gate is closed', async () => {
    // Arrange
    const app = createApp();

    // Act — verb mismatch on a gated-off route is still a 404, not a 405.
    // Disclosure of the route's existence via 405 would defeat the
    // exposure-surface contract.
    const res = await app.request(
      '/api/v1/_debug/synthetic-failure',
      { method: 'GET' },
      {} satisfies RouteEnv,
    );

    // Assert
    expect(res.status).toBe(404);
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/v1/_debug/synthetic-failure — gate open', () => {
  it('throws SyntheticFailureError and routes it through Sentry.captureException', async () => {
    // Arrange
    const app = createApp();

    // Act — Hono converts the throw into a 500 by default; the contract
    // we lock here is that captureException receives the typed error.
    const res = await app.request('/api/v1/_debug/synthetic-failure', { method: 'POST' }, {
      OBSERVABILITY_SYNTHETIC_FAILURE_ENABLED: 'true',
    } satisfies RouteEnv);

    // Assert — handler did throw; Hono surfaced a 5xx (the alert path
    // downstream of captureException is exercised by the Sentry SDK in
    // production, not by this contract).
    expect(res.status).toBeGreaterThanOrEqual(500);

    // Assert — captureException was invoked exactly once with a
    // SyntheticFailureError instance. We assert on the constructor name
    // rather than `instanceof` because the class is module-private and
    // the test deliberately has no handle to it (Story #275 invariant).
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    const capturedArg = captureExceptionMock.mock.calls[0]?.[0];
    expect(capturedArg).toBeInstanceOf(Error);
    expect((capturedArg as Error).constructor.name).toBe('SyntheticFailureError');
  });

  it('still returns 404 on GET even when the gate is open (POST-only route)', async () => {
    // Arrange — the route MUST be POST-only. A GET when the gate is open
    // must NOT throw, and must NOT 405; it returns 404 to preserve the
    // exposure-surface contract.
    const app = createApp();

    // Act
    const res = await app.request('/api/v1/_debug/synthetic-failure', { method: 'GET' }, {
      OBSERVABILITY_SYNTHETIC_FAILURE_ENABLED: 'true',
    } satisfies RouteEnv);

    // Assert
    expect(res.status).toBe(404);
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });
});
