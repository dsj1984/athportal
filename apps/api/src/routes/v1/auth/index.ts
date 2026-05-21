// apps/api/src/routes/v1/auth/index.ts
//
// PLACEHOLDER — Story #564 / Task #572 owns the real implementation.
//
// This Story (#563) needs to mount the `/api/v1/auth/*` subtree BEFORE
// `requireOnboarded` so that the (future) onboarding handler itself is
// reachable to an un-onboarded caller. Story #564 lands in parallel and
// will overwrite this file with the real `authRoute` that mounts the
// onboarding handler under `/onboard`.
//
// Until that merge lands, this placeholder exposes an `authRoute` with
// no handlers so:
//
//   1. `index.ts` can import and mount it without a compile error.
//   2. Any request to `/api/v1/auth/*` falls through to 404 (Hono's
//      default), which is the correct behaviour while the onboarding
//      endpoint does not yet exist.
//   3. The mount line in `index.ts` ends up on the correct side of the
//      `requireOnboarded` gate so the wiring is permanent.
//
// When Story #564 rebases onto `epic/8`, the conflict here is
// resolved by accepting Story #564's version of this file.

import { Hono } from 'hono';
import type { RequireInternalUserEnv } from '../../../middleware/auth';

export const authRoute = new Hono<RequireInternalUserEnv>();
