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

const app = new Hono<{ Bindings: RequestLoggerEnv }>();

app.use('*', requestLogger());

app.get('/health', (c) => c.json({ ok: true }));

export default app.fetch;
export { app };
