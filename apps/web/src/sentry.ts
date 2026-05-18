// apps/web/src/sentry.ts
//
// Thin Sentry wrapper for the Astro web runtime. App code imports the
// configured client from this one path so we never reach into the
// vendor namespace ad hoc.
//
// The Astro integration registered in `astro.config.ts` performs the
// real `Sentry.init({ dsn, release, ... })` at build time. At runtime
// the resulting client is reachable via `Sentry.getClient()` — this
// module re-exports it as the default so callers can do:
//
//   import sentryClient from './sentry';
//   sentryClient?.captureException(err);
//
// When SENTRY_DSN_WEB is unset (local dev, preview), the integration is
// skipped in `astro.config.ts` and `getClient()` returns `undefined`;
// the default export is `undefined` and callers must tolerate the null
// branch.
//
// Story #255 — Sentry baseline init across all three runtimes.

import { getClient } from '@sentry/astro';

const client = getClient();

export default client;
