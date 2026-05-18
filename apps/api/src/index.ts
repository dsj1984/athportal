// apps/api/src/index.ts
//
// First runtime code in @repo/api: the Hono app shell that mounts the
// request-completion logger, the Clerk auth chain, and the protected
// /api/v1 router.
//
// Middleware order (load-bearing — `docs/architecture.md` §5):
//
//   1. requestLogger()             — first, so every response (auth or
//                                    not) emits a LogEvent.
//   2. clerkAuth()                  — second, on `*`. Validates the
//                                    Clerk JWT and writes
//                                    `c.var.clerkSubjectId`. UNAUTH for
//                                    missing/invalid tokens.
//   3. requireInternalUser()        — third, only on `/api/v1/*`
//                                    (excluding `/api/v1/health` and
//                                    `/api/v1/_debug/*`). Resolves the
//                                    internal `users` row via JIT
//                                    insert, attaches `c.var.auth`.
//
// /health and /api/v1/health are unauthenticated by design — load
// balancer liveness checks must not depend on Clerk.

import { Hono } from 'hono';
import { type ClerkAuthEnv, clerkAuth, requireInternalUser } from './middleware/auth';
import { type RequestLoggerEnv, requestLogger } from './middleware/request-logger';
import { type SyntheticFailureEnv, syntheticFailureRoute } from './routes/debug/synthetic-failure';
import { meRoute } from './routes/v1/me';
import { signOutRoute } from './routes/v1/sign-out';
import { userRoleRoute } from './routes/v1/users/role';

type AppEnv = RequestLoggerEnv & SyntheticFailureEnv & ClerkAuthEnv;

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

// 4) Clerk JWT validation. Runs on every remaining request.
app.use('*', clerkAuth());

// 5) JIT internal-user resolution. Scoped to /api/v1/* so future
//    non-versioned routes (admin UI APIs, webhooks) can opt in
//    explicitly rather than inherit it implicitly.
app.use('/api/v1/*', requireInternalUser());

// 6) Protected routes.
app.route('/api/v1/me', meRoute);
app.route('/api/v1/sign-out', signOutRoute);
// PATCH /api/v1/users/:id/role — last-admin invariant route. The
// child router defines `/:id/role` so we mount at `/api/v1/users`.
app.route('/api/v1/users', userRoleRoute);

export default app.fetch;
export { app };
