// apps/api/src/middleware/requireOnboarded.test.ts
//
// Unit tests for the `requireOnboarded` Hono middleware (Story #563 /
// Task #571).
//
// Tier: unit. Per docs/testing-strategy.md the contract-level wire
// shape is pinned by `require-onboarded.contract.test.ts` against a
// real ephemeral SQLite via `createTestApp(db, { actor })`; these unit
// tests instead drive the middleware directly with a stubbed DB so the
// three contractual behaviours can be exercised without the migration
// fixture.
//
// Behaviours under test:
//
//   1. Returns 403 with `{ success: false, error: { code:
//      'ONBOARDING_REQUIRED', message } }` when `onboardedAt` is null.
//   2. Calls `next()` (i.e. lets the downstream handler run) when
//      `onboardedAt` is a non-null Date.
//   3. Routes through the sanctioned `getOnboardingState` accessor —
//      verified by stubbing the accessor with `vi.mock` and asserting
//      it was called with the actor's userId.
//
// The middleware is colocated with its source, so this test sits next
// to `requireOnboarded.ts` rather than in a `__tests__/` directory.

import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@repo/shared/db/queries/users', () => ({
  getOnboardingState: vi.fn(),
}));

import { getOnboardingState } from '@repo/shared/db/queries/users';
import type { AuthContext, RequireInternalUserEnv } from './auth';
import { requireOnboarded } from './requireOnboarded';

const mockedGetOnboardingState = vi.mocked(getOnboardingState);

const STUB_DB = { __stub: 'db' } as const;

function actor(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: 'u_test_1',
    clerkSubjectId: 'user_test_subject',
    email: 'test@example.invalid',
    role: 'member',
    orgId: null,
    teamId: null,
    ...overrides,
  };
}

function buildApp(auth: AuthContext) {
  const app = new Hono<RequireInternalUserEnv>();
  app.use('*', async (c, next) => {
    // Cast through `unknown` because the stub deliberately does not
    // implement the structural Drizzle handle shape — the middleware
    // hands the value to `getOnboardingState`, which is mocked, so the
    // shape is never inspected at runtime.
    c.set('db', STUB_DB as unknown as Parameters<typeof getOnboardingState>[0]);
    c.set('clerkSubjectId', auth.clerkSubjectId);
    c.set('auth', auth);
    await next();
  });
  app.use('/api/v1/*', requireOnboarded());
  app.get('/api/v1/echo', (c) => c.json({ success: true, data: { ok: true } }));
  return app;
}

beforeEach(() => {
  mockedGetOnboardingState.mockReset();
});

describe('requireOnboarded', () => {
  it('returns 403 with the ONBOARDING_REQUIRED envelope when onboardedAt is null', async () => {
    mockedGetOnboardingState.mockReturnValueOnce({
      onboardedAt: null,
      ageAttestedAt: null,
    });

    const app = buildApp(actor());
    const res = await app.request('/api/v1/echo', { method: 'GET' });

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      success: false,
      error: { code: 'ONBOARDING_REQUIRED' },
    });
  });

  it('calls next() and lets the handler run when onboardedAt is a non-null Date', async () => {
    mockedGetOnboardingState.mockReturnValueOnce({
      onboardedAt: new Date('2026-05-01T00:00:00.000Z'),
      ageAttestedAt: new Date('2026-05-01T00:00:00.000Z'),
    });

    const app = buildApp(actor());
    const res = await app.request('/api/v1/echo', { method: 'GET' });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, data: { ok: true } });
  });

  it('looks up onboarding state by the actor userId via the sanctioned accessor', async () => {
    mockedGetOnboardingState.mockReturnValueOnce({
      onboardedAt: new Date('2026-05-01T00:00:00.000Z'),
      ageAttestedAt: null,
    });

    const app = buildApp(actor({ userId: 'u_coach_42' }));
    await app.request('/api/v1/echo', { method: 'GET' });

    expect(mockedGetOnboardingState).toHaveBeenCalledTimes(1);
    expect(mockedGetOnboardingState).toHaveBeenCalledWith(STUB_DB, 'u_coach_42');
  });

  it('returns 403 (not 500) when the accessor returns null — missing user row', async () => {
    // `requireInternalUser` upstream guarantees a row exists, so this
    // path is defensive. The middleware MUST NOT crash and MUST NOT
    // echo internal state — it surfaces the same ONBOARDING_REQUIRED
    // envelope as the un-onboarded path.
    mockedGetOnboardingState.mockReturnValueOnce(null);

    const app = buildApp(actor());
    const res = await app.request('/api/v1/echo', { method: 'GET' });

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      success: false,
      error: { code: 'ONBOARDING_REQUIRED' },
    });
  });

  it('does not leak internal error details in the 403 body', async () => {
    mockedGetOnboardingState.mockReturnValueOnce({
      onboardedAt: null,
      ageAttestedAt: null,
    });

    const app = buildApp(actor());
    const res = await app.request('/api/v1/echo', { method: 'GET' });
    const text = await res.text();

    expect(text).not.toMatch(/stack/i);
    expect(text).not.toMatch(/onboarded_at/i);
    expect(text).not.toMatch(/sql/i);
  });
});
