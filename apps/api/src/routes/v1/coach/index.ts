// apps/api/src/routes/v1/coach/index.ts
//
// Coach router root for `/api/v1/coach/*` (Epic #11 / Story #912 /
// Task #919).
//
// Mount point for the coach-owned roster surface. The router does NOT
// add a `requireRole` gate the way the admin tree does — coach
// permissions are per-team (a `member` may legitimately coach team A
// while remaining a `member` of org A as a whole), so authorization
// is enforced **per route** via `requireCoachOnTeam(actor, teamId)`
// inside each handler. Adding a coarse role gate here would either
// over-refuse (block legitimate coaches whose `users.role` is
// `member`) or under-refuse (admit `member` actors who happen NOT to
// coach the team).
//
// Composition (mirrors `apps/api/src/index.ts`):
//
//   clerkAuth → withDb → requireInternalUser → requireOnboarded
//     → app.route('/api/v1/coach', coachRoute)
//
// The roster sub-router is mounted at `/teams/:teamId/roster` so the
// final URL surface matches Tech Spec #906 §API exactly:
//
//   GET /api/v1/coach/teams/:teamId/roster                          → list
//   GET /api/v1/coach/teams/:teamId/roster/entries/:entryId         → one
//
// Future Stories in Epic #11 (invites, mutations) will add additional
// sub-routers (`./invites`, `./roster-mutations`, …) here without
// re-editing this index — the same scaffolding pattern Epic #10 used
// for the admin tree.

import { Hono } from 'hono';
import type { RequireInternalUserEnv } from '../../../middleware/auth';
import { coachRosterRoute } from './roster';

export const coachRoute = new Hono<RequireInternalUserEnv>();

// Mount the roster sub-router at the team-scoped path. The teamId is
// captured at this layer so the sub-router's handlers can read it as
// `c.req.param('teamId')` — Hono propagates path params down the
// composed routers.
coachRoute.route('/teams/:teamId/roster', coachRosterRoute);
