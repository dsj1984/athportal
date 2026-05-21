// apps/api/src/middleware/requireOnboarded.ts
//
// Server-side belt-and-braces onboarding gate (Epic #8, Story #563,
// Task #571). The Astro middleware on the web app already redirects an
// un-onboarded session to the onboarding flow; this Hono middleware
// covers the parallel API surface so that a direct API call (from a
// scripted client, a misconfigured worker, or a developer prodding the
// route during onboarding) cannot bypass the redirect.
//
// Composition (see `apps/api/src/index.ts`):
//
//   clerkAuth() → requireInternalUser() → requireOnboarded()
//
// Runs only on routes mounted UNDER `app.use('/api/v1/*', requireOnboarded())`.
// Routes that legitimately need to be reachable by an un-onboarded
// caller — the onboarding handler itself, sign-out, the health probe,
// and the gated debug rehearsal — are mounted BEFORE the `use(...)`
// line in `index.ts`. There is no per-route opt-out flag on this
// middleware; the only opt-out is mount order.
//
// Contract:
//
//   - Reads `c.var.auth.userId` (populated by `requireInternalUser`).
//   - Reads `c.var.db` (populated by the API shell or `createTestApp`).
//   - Resolves onboarding state via the sanctioned
//     `getOnboardingState` accessor from
//     `@repo/shared/db/queries/users`. The lint-baseline ratchet
//     forbids any other path to `users.onboarded_at` (Story #555 /
//     Task #570), so this middleware must NOT read `.onboardedAt`
//     directly.
//   - Returns `403` with the canonical error envelope
//     `{ success: false, error: { code: 'ONBOARDING_REQUIRED', message } }`
//     when `onboardedAt` is null.
//   - Calls `next()` when `onboardedAt` is a non-null Date.
//   - When the user row cannot be found (`getOnboardingState` returns
//     `null`), treats the caller as un-onboarded and returns 403.
//     `requireInternalUser` guarantees a row exists by the time we run,
//     so this branch is defensive — but it must not crash and must not
//     echo any internal state to the caller.
//
// Per `.agents/rules/security-baseline.md` (Output & Rendering), no
// internal error details are surfaced in the response body. The error
// message is a fixed, user-facing string.

import { getOnboardingState } from '@repo/shared/db/queries/users';
import type { MiddlewareHandler } from 'hono';
import type { RequireInternalUserEnv } from './auth';

/**
 * Canonical error-code surface for the onboarding gate. Kept as a
 * single-member union so a future code addition is a deliberate change
 * here, not an incidental string-literal drift at a call site.
 */
type OnboardingErrorCode = 'ONBOARDING_REQUIRED';

interface OnboardingErrorBody {
  readonly success: false;
  readonly error: {
    readonly code: OnboardingErrorCode;
    readonly message: string;
  };
}

function onboardingRequired(): OnboardingErrorBody {
  return {
    success: false,
    error: {
      code: 'ONBOARDING_REQUIRED',
      message: 'Onboarding is required before this resource can be accessed.',
    },
  };
}

/**
 * `requireOnboarded` middleware. Must be mounted AFTER
 * `requireInternalUser` so `c.var.auth.userId` and `c.var.db` are
 * populated. Returns a Hono middleware that gates downstream handlers
 * on the presence of a non-null `users.onboarded_at` for the calling
 * actor.
 */
export function requireOnboarded(): MiddlewareHandler<RequireInternalUserEnv> {
  return async (c, next) => {
    const auth = c.get('auth');
    const db = c.get('db');

    const state = getOnboardingState(db, auth.userId);

    if (state === null || state.onboardedAt === null) {
      return c.json(onboardingRequired(), 403);
    }

    await next();
    return undefined;
  };
}
