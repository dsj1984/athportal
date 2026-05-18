// apps/api/src/routes/v1/me.ts
//
// GET /api/v1/me — returns the JIT-resolved AuthContext for the current
// caller. Drives client-side session-restore checks and powers the
// per-persona protected-route smoke scenarios documented in Tech Spec
// #318 §F.
//
// Auth: `member`+. Mounted under the `requireInternalUser` chain on
// `/api/v1/*`, so by the time the handler runs `c.var.auth` is
// populated with the canonical AuthContext.
//
// Response envelope (success): per Tech Spec #318 §API the success
// envelope is `{ success: true, data: T }`. The handler returns the
// AuthContext fields the client needs to render the post-sign-in shell;
// it intentionally excludes internal id columns that would not be
// useful to a UI (`updated_at`, `created_at`).

import { Hono } from 'hono';
import type { RequireInternalUserEnv } from '../../middleware/auth';

export const meRoute = new Hono<RequireInternalUserEnv>();

meRoute.get('/', (c) => {
  const auth = c.get('auth');
  return c.json({
    success: true,
    data: {
      userId: auth.userId,
      role: auth.role,
      orgId: auth.orgId,
      teamId: auth.teamId,
      email: auth.email,
    },
  });
});
