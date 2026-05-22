// apps/api/src/routes/v1/admin/_placeholder.ts
//
// `placeholderRouter(featureName)` — factory shared by the six feature
// sub-routers under `/api/v1/admin/*` (Story #654, Task #658).
//
// Story #654 lands the admin router *tree* so the three Stories
// downstream (#655 org, #656 teams, #657 invitations) can refactor a
// single file per feature without re-editing the API entrypoint. Each
// feature sub-router is, on this Story, a placeholder that responds
// `501 NOT_IMPLEMENTED` with the canonical error envelope on any
// handler invocation:
//
//   { success: false, error: { code: 'NOT_IMPLEMENTED', message } }
//
// The placeholder uses `app.all('*', ...)` to catch every HTTP verb on
// every path under the sub-router's mount point, so a future Story
// that adds a real GET handler still sees 501 for the verbs it has
// not yet implemented. The factory is the single point of truth for
// the placeholder wire shape — three Stories from now, when half the
// sub-routers ship real handlers and half are still placeholders, the
// placeholder envelope MUST NOT drift.
//
// Per `.agents/rules/security-baseline.md` (Output & Rendering): the
// response carries no stack trace, no internal class name, no
// feature-name detail beyond what the calling client already knows
// from the URL it just hit.

import { Hono } from 'hono';
import type { RequireInternalUserEnv } from '../../../middleware/auth';

interface NotImplementedBody {
  readonly success: false;
  readonly error: {
    readonly code: 'NOT_IMPLEMENTED';
    readonly message: string;
  };
}

function notImplemented(featureName: string): NotImplementedBody {
  return {
    success: false,
    error: {
      code: 'NOT_IMPLEMENTED',
      message: `Admin ${featureName} endpoints are not yet implemented.`,
    },
  };
}

/**
 * Build a Hono sub-router that responds 501 NOT_IMPLEMENTED for every
 * verb on every sub-path. The returned router is typed against
 * `RequireInternalUserEnv` so it composes cleanly under the admin
 * router's `requireRole('org_admin')` gate — the gate runs first;
 * the placeholder body runs only when the gate admits the request.
 */
export function placeholderRouter(featureName: string): Hono<RequireInternalUserEnv> {
  const router = new Hono<RequireInternalUserEnv>();
  router.all('*', (c) => c.json(notImplemented(featureName), 501));
  return router;
}
