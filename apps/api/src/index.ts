// apps/api/src/index.ts
//
// First runtime code in @repo/api: a minimal Hono app shell.
//
// The request-completion middleware (Story #257) is mounted as the very
// first handler so every subsequent route — including future feature
// routers — emits a LogEvent without per-route opt-in. /health is the
// only route on Day 1; feature routes land via dedicated routers in
// subsequent Epics.

import { Hono } from 'hono';
import { type RequestLoggerEnv, requestLogger } from './middleware/request-logger';
import { type SyntheticFailureEnv, syntheticFailureRoute } from './routes/debug/synthetic-failure';

type AppEnv = RequestLoggerEnv & SyntheticFailureEnv;

const app = new Hono<{ Bindings: AppEnv }>();

app.use('*', requestLogger());

app.get('/health', (c) => c.json({ ok: true }));

// Gated synthetic-failure rehearsal endpoint (Story #275). The route
// reads OBSERVABILITY_SYNTHETIC_FAILURE_ENABLED off the Worker bindings;
// when unset (the default in every environment except a staging
// rehearsal window) the route is indistinguishable from a non-existent
// path. See docs/ops/observability-runbook.md § "Synthetic-failure
// rehearsal" for the operator procedure.
app.route('/api/v1/_debug/synthetic-failure', syntheticFailureRoute);

export default app.fetch;
export { app };
