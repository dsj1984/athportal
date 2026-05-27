// apps/api/src/index.ts
//
// First runtime code in @repo/api: the Hono app shell that mounts the
// request-completion logger, the Clerk auth chain, the onboarding
// gate, and the protected /api/v1 router.
//
// Middleware order (load-bearing — `docs/architecture.md` §5):
//
//   1. requestLogger()             — first, so every response (auth or
//                                    not) emits a LogEvent.
//   2. clerkAuth()                  — second, on `*`. Validates the
//                                    Clerk JWT and writes
//                                    `c.var.clerkSubjectId`. UNAUTH for
//                                    missing/invalid tokens.
//   2.5 withDb()                    — between clerkAuth and
//                                    requireInternalUser. Reads
//                                    `c.env.DB` (a Drizzle handle
//                                    constructed by the host: the Node
//                                    dev server, or — Epic #27 — the
//                                    Workers entrypoint) and publishes
//                                    it as `c.var.db`. Mounted only on
//                                    `/api/v1/*` because the
//                                    unauthenticated probes
//                                    (`/health`, webhooks) do not
//                                    touch the DB. Story #760.
//   3. requireInternalUser()        — third, only on `/api/v1/*`
//                                    (excluding `/api/v1/health` and
//                                    `/api/v1/_debug/*`). Resolves the
//                                    internal `users` row via JIT
//                                    insert, attaches `c.var.auth`.
//                                    Reads `c.var.db` set by withDb.
//   4. requireOnboarded()           — fourth, only on `/api/v1/*`.
//                                    Returns 403 ONBOARDING_REQUIRED
//                                    when `users.onboarded_at` is null.
//                                    Exempt routes — the onboarding
//                                    endpoint itself, sign-out, the
//                                    health probe, and the gated debug
//                                    rehearsal — are mounted BEFORE this
//                                    middleware (mount order is the
//                                    only opt-out mechanism).
//
// /health and /api/v1/health are unauthenticated by design — load
// balancer liveness checks must not depend on Clerk.

import { Hono } from 'hono';
import { type ClerkAuthEnv, clerkAuth, requireInternalUser } from './middleware/auth';
import { type RequestLoggerEnv, requestLogger } from './middleware/request-logger';
import { requireOnboarded } from './middleware/requireOnboarded';
import { withDb } from './middleware/withDb';
import {
  type CreateTestUserDebugEnv,
  createTestUserDebugRoute,
} from './routes/debug/create-test-user';
import { type SyntheticFailureEnv, syntheticFailureRoute } from './routes/debug/synthetic-failure';
import { adminRoute } from './routes/v1/admin';
import { authRoute } from './routes/v1/auth';
import { coachRoute } from './routes/v1/coach';
import { meRoute } from './routes/v1/me';
import { publicRosterInvitesRoute } from './routes/v1/public/roster-invites';
import { signOutRoute } from './routes/v1/sign-out';
import { userRoleRoute } from './routes/v1/users/role';
import { clerkInvitationAcceptedRoute } from './routes/webhooks/clerk-invitation-accepted';

type AppEnv = RequestLoggerEnv & SyntheticFailureEnv & CreateTestUserDebugEnv & ClerkAuthEnv;

const app = new Hono<AppEnv>();

// 1) Request-completion logger — first so every response is recorded.
app.use('*', requestLogger());

// 2) Public liveness probes — declared BEFORE clerkAuth so anonymous
//    callers can reach them. /health and /api/v1/health are the only
//    routes that bypass auth (per Tech Spec #318 §API).
app.get('/health', (c) => c.json({ ok: true }));
app.get('/api/v1/health', (c) => c.json({ ok: true }));

// 3) Gated synthetic-failure rehearsal endpoint (Story #275). Kept
//    above auth so a misconfigured rehearsal does not also test the
//    auth path. The route is gated by an env binding — see its module
//    docstring.
app.route('/api/v1/_debug/synthetic-failure', syntheticFailureRoute);

// 3.1) Gated dev-only test-user creation seam (Story #963). Mounted at
//      the same level as the synthetic-failure rehearsal: BEFORE
//      clerkAuth so the Playwright fixture can call it without a Clerk
//      session, and gated by `DEBUG_TEST_USER_CREATION_ENABLED` so a
//      production build never exposes it. The route's own contract
//      test (`routes/debug/create-test-user.contract.test.ts`) locks
//      the 404-on-closed-gate / 503-on-non-test-key invariants.
app.route('/api/v1/_debug/create-test-user', createTestUserDebugRoute);

// 3.5) Clerk webhooks. Mounted BEFORE clerkAuth because webhook
//      callers present a Standard Webhooks signature, not a Clerk
//      session cookie — the signature verifier inside the handler is
//      the security boundary for this endpoint (Epic #10 / Story #655
//      / Task #666).
app.route('/webhooks/clerk/invitation-accepted', clerkInvitationAcceptedRoute);

// 3.6) Public tokenized roster-invite handshake (Epic #11 / Story #926).
//      Mounted BEFORE clerkAuth because the plaintext token in the URL
//      is the sole authorization — the route refuses sessions and
//      accepts anonymous callers by design. `withDb` runs only on this
//      sub-tree so the handler has a Drizzle handle on `c.var.db`.
app.use('/api/v1/public/*', withDb());
app.route('/api/v1/public/roster-invites', publicRosterInvitesRoute);

// 4) Clerk JWT validation. Runs on every remaining request.
app.use('*', clerkAuth());

// 4.5) DB handle bridge. Publishes `c.env.DB` as `c.var.db` so the JIT
//      user lookup and every downstream route can issue Drizzle queries.
//      Scoped to /api/v1/* — the public probes and the Clerk webhook
//      receiver do not touch the database. Story #760.
app.use('/api/v1/*', withDb());

// 5) JIT internal-user resolution. Scoped to /api/v1/* so future
//    non-versioned routes (admin UI APIs, webhooks) can opt in
//    explicitly rather than inherit it implicitly.
app.use('/api/v1/*', requireInternalUser());

// 6) Onboarding-exempt protected routes. These run AFTER auth + JIT
//    resolution (so they have `c.var.auth`) but BEFORE the
//    `requireOnboarded` gate, because they need to be reachable to an
//    un-onboarded caller.
//
//    - /api/v1/auth/* hosts the onboarding handler itself (Story #564,
//      Task #576). The user must reach it to stamp `onboarded_at`.
//    - /api/v1/sign-out lets an un-onboarded user sign out without
//      being trapped behind the gate.
app.route('/api/v1/auth', authRoute);
app.route('/api/v1/sign-out', signOutRoute);

// 7) Onboarding gate. Every /api/v1/* route mounted AFTER this line is
//    refused with 403 ONBOARDING_REQUIRED for a caller whose
//    `users.onboarded_at` is null.
app.use('/api/v1/*', requireOnboarded());

// 8) Protected, onboarded-only routes.
app.route('/api/v1/me', meRoute);
// PATCH /api/v1/users/:id/role — last-admin invariant route. The
// child router defines `/:id/role` so we mount at `/api/v1/users`.
app.route('/api/v1/users', userRoleRoute);
// Admin router tree (Story #654, Epic #10). The router itself gates
// the entire `/api/v1/admin/*` subtree behind `requireRole('org_admin')`;
// downstream Stories swap individual placeholder sub-routers for real
// handlers without re-editing this entrypoint.
app.route('/api/v1/admin', adminRoute);
// Coach router tree (Epic #11 / Story #912). Each handler under
// `/api/v1/coach/*` enforces `requireCoachOnTeam(actor, teamId)` per
// route — there is no role gate at the mount layer because coach
// permissions are per-team, not per-role (see `./routes/v1/coach/index.ts`).
app.route('/api/v1/coach', coachRoute);

export default app.fetch;
export { app };
