// apps/web/src/middleware.ts
//
// Astro middleware that attaches the Clerk session to `Astro.locals.auth`
// on every request. Mounting `clerkMiddleware()` from `@clerk/astro/server`
// is the canonical wiring documented in the Tech Spec for Epic #7 (#318)
// — it validates the `__session` cookie, populates the per-request auth
// context, and is the load-bearing seam that every protected route in
// apps/web reads through.
//
// Story #328 (Task #331) — Clerk SDK wiring for the web runtime.

import { clerkMiddleware } from '@clerk/astro/server';

export const onRequest = clerkMiddleware();
