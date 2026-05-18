// apps/api/src/index.ts
//
// First runtime code in @repo/api: a minimal Hono app shell so the
// request-completion middleware (Story #257) has a host to mount into.
// Routes are intentionally limited to /health on Day 1 — feature routes
// land via dedicated routers in subsequent Epics.

import { Hono } from 'hono';

const app = new Hono();

app.get('/health', (c) => c.json({ ok: true }));

export default app.fetch;
export { app };
