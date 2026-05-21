// apps/web/src/middleware.allowlist.test.ts
//
// Table-driven unit tests pinning the allowlist contract enforced by the
// Astro onboarding gate. Each row of the matrix names one path, the
// expected gate outcome (`next` or `redirect`) for an un-onboarded actor,
// and a short justification — the justification doubles as a failure
// message when a future edit silently widens or narrows the allowlist.
//
// The test is intentionally a *pure-function* exercise of
// `createOnboardingGate`: it constructs a minimal request-shaped
// context, hands the gate a deterministic lookup that always reports an
// un-onboarded actor, and asserts the gate's behaviour without spinning
// up a real Astro runtime. Per Tech Spec #490 §Architecture & Design,
// "Allowlist hard-coded inline; pure-function tested."
//
// Story #562 (Task #578) — Add table-driven unit tests covering the
// allowlist matrix.

import { type Mock, describe, expect, it, vi } from 'vitest';
import { type GateContext, createOnboardingGate, isAllowlisted } from './middleware';

type RedirectMock = Mock<(path: string, status?: number) => Response>;

interface TestContext extends GateContext {
  readonly redirect: RedirectMock;
}

/**
 * Build a stand-in for the per-request Astro context shape the gate
 * consumes. Only the fields the gate actually reads are populated — the
 * gate's surface area is small on purpose so the harness can stay
 * minimal.
 */
function buildContext(pathname: string, userId: string | null): TestContext {
  const redirect: RedirectMock = vi.fn(
    (path: string, status?: number) =>
      new Response(null, { status: status ?? 302, headers: { Location: path } }),
  );
  return {
    url: new URL(`https://app.example.invalid${pathname}`),
    locals: {
      auth: () => ({ userId }),
    },
    redirect,
  };
}

/**
 * Stub `next()` that resolves to a 200 OK so the gate's pass-through
 * branches return a proper `Promise<Response>` and `vi.fn` records the
 * single invocation.
 */
type NextMock = Mock<() => Promise<Response>>;

function buildNext(): NextMock {
  return vi.fn(() => Promise.resolve(new Response(null, { status: 200 })));
}

/**
 * Deterministic lookup that always reports "user exists, not yet
 * onboarded". The gate's redirect branch only fires when the lookup
 * returns a non-null state with `onboardedAt === null`, so this is the
 * worst-case actor for every allowlist row.
 */
const unOnboardedLookup = () => ({ onboardedAt: null, ageAttestedAt: null });

const ALLOWLIST_PATHS: ReadonlyArray<{ path: string; why: string }> = [
  { path: '/onboarding', why: 'the gate destination must not loop back on itself' },
  { path: '/sign-in', why: 'sign-in must be reachable to authenticate at all' },
  { path: '/sign-in/factor-one', why: 'sign-in carries Clerk-rendered child segments' },
  { path: '/sign-up', why: 'sign-up must be reachable to onboard a new account' },
  { path: '/sign-up/verify-email-address', why: 'sign-up carries Clerk-rendered child segments' },
  { path: '/sign-out', why: 'an un-onboarded user must be able to sign out' },
  { path: '/api/v1/auth/onboard', why: 'the endpoint that flips onboarded_at must be reachable' },
  { path: '/api/v1/health', why: 'health checks must run pre-onboarding' },
  { path: '/health', why: 'the web-side health endpoint mirrors the API one' },
  { path: '/clerk/sso-callback', why: "Clerk's SSO callback path must complete unimpeded" },
];

const PROTECTED_PATHS: ReadonlyArray<{ path: string; why: string }> = [
  { path: '/dashboard', why: 'the canonical post-onboarding landing page' },
  {
    path: '/api/v1/me',
    why: 'protected /api/v1/* surfaces still bounce through the web gate for SSR navigation',
  },
];

describe('middleware allowlist matrix', () => {
  describe('isAllowlisted (pure)', () => {
    for (const { path, why } of ALLOWLIST_PATHS) {
      it(`allows ${path} — ${why}`, () => {
        expect(isAllowlisted(path)).toBe(true);
      });
    }

    for (const { path, why } of PROTECTED_PATHS) {
      it(`blocks ${path} — ${why}`, () => {
        expect(isAllowlisted(path)).toBe(false);
      });
    }
  });

  describe('createOnboardingGate (un-onboarded actor)', () => {
    const gate = createOnboardingGate(unOnboardedLookup);
    const SIGNED_IN_USER_ID = 'clerk_sub_test_user';

    for (const { path, why } of ALLOWLIST_PATHS) {
      it(`calls next() for ${path} — ${why}`, async () => {
        const ctx = buildContext(path, SIGNED_IN_USER_ID);
        const next = buildNext();
        await gate(ctx, next);
        expect(next).toHaveBeenCalledTimes(1);
        expect(ctx.redirect).not.toHaveBeenCalled();
      });
    }

    for (const { path, why } of PROTECTED_PATHS) {
      it(`302-redirects ${path} to /onboarding — ${why}`, async () => {
        const ctx = buildContext(path, SIGNED_IN_USER_ID);
        const next = buildNext();
        await gate(ctx, next);
        expect(next).not.toHaveBeenCalled();
        expect(ctx.redirect).toHaveBeenCalledTimes(1);
        expect(ctx.redirect).toHaveBeenCalledWith('/onboarding', 302);
      });
    }
  });

  describe('createOnboardingGate (no-op branches)', () => {
    const SIGNED_IN_USER_ID = 'clerk_sub_test_user';

    it('passes anonymous requests straight through (Clerk owns that redirect)', async () => {
      const lookup = vi.fn();
      const gate = createOnboardingGate(lookup);
      const ctx = buildContext('/dashboard', null);
      const next = buildNext();
      await gate(ctx, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(lookup).not.toHaveBeenCalled();
    });

    it('passes through when the user is already onboarded', async () => {
      const onboardedLookup = () => ({
        onboardedAt: new Date('2026-01-01T00:00:00.000Z'),
        ageAttestedAt: new Date('2026-01-01T00:00:00.000Z'),
      });
      const gate = createOnboardingGate(onboardedLookup);
      const ctx = buildContext('/dashboard', SIGNED_IN_USER_ID);
      const next = buildNext();
      await gate(ctx, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(ctx.redirect).not.toHaveBeenCalled();
    });

    it('redirects to /onboarding when the lookup returns null (safe default — un-onboarded)', async () => {
      // PRD G1 / AC-15: an authenticated subject with no internal row
      // is, by definition, not onboarded yet. The middleware's safe
      // default for the placeholder lookup is "treat null as
      // un-onboarded and 302". This test pins that contract so a future
      // refactor that silently flips the semantics back to "pass
      // through" cannot land without flipping this assertion.
      const missingLookup = () => null;
      const gate = createOnboardingGate(missingLookup);
      const ctx = buildContext('/dashboard', SIGNED_IN_USER_ID);
      const next = buildNext();
      await gate(ctx, next);
      expect(next).not.toHaveBeenCalled();
      expect(ctx.redirect).toHaveBeenCalledTimes(1);
      expect(ctx.redirect).toHaveBeenCalledWith('/onboarding', 302);
    });
  });
});
