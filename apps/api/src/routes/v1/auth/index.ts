// apps/api/src/routes/v1/auth/index.ts
//
// Router barrel for the `/api/v1/auth` namespace introduced by Epic #8 /
// Story #564 / Task #572. Tech Spec #490 §Core Components.
//
// Composes the per-resource Hono routers under one `/api/v1/auth` mount
// so `apps/api/src/index.ts` can wire the whole namespace with a single
// `app.route('/api/v1/auth', authRoute)` call — matching the pattern
// already used for `meRoute`, `signOutRoute`, and `userRoleRoute`.
//
// Mount-order contract (Tech Spec #490 §API Changes):
//
//   `authRoute` MUST be mounted BEFORE the global `requireOnboarded`
//   chain. The onboarding endpoint itself is what stamps
//   `users.onboarded_at`; gating it behind the onboarded check would
//   make every caller's first onboarding submission return 403
//   `ONBOARDING_REQUIRED`. `clerkAuth` and `requireInternalUser` still
//   run earlier in the chain — `authRoute` is authenticated, just not
//   onboarded-gated.

import { Hono } from 'hono';
import type { RequireInternalUserEnv } from '../../../middleware/auth';
import { onboardRoute } from './onboard';

export const authRoute = new Hono<RequireInternalUserEnv>();

authRoute.route('/onboard', onboardRoute);
