// apps/api/src/routes/v1/admin/index.ts
//
// Admin router root for `/api/v1/admin/*` (Story #654, Task #658,
// Epic #10).
//
// This file is the single mount point for every admin sub-feature.
// The three downstream Stories under Epic #10 (#655 org, #656 teams,
// #657 invitations) refactor their feature's sub-router file
// (`./org.ts`, `./teams.ts`, `./invitations.ts`) without re-editing
// this index — that is the whole point of standing the tree up in
// one Story.
//
// Composition (load-bearing — mirrors `apps/api/src/index.ts`):
//
//   1. requireRole('org_admin') — gates the ENTIRE /api/v1/admin tree.
//      Runs first so each sub-router can assume the actor is an
//      `org_admin` (or a `dev_admin` — the role gate admits the
//      platform-root role on every triple, see
//      `apps/api/src/middleware/requireRole.ts`).
//   2. Six feature sub-routers mounted at fixed paths. The paths are
//      part of the API contract — the URL stays the same across the
//      placeholder-to-real-handler swap.
//
// Mount sequence in the API entrypoint:
//
//   clerkAuth → requireInternalUser → requireOnboarded
//     → app.route('/api/v1/admin', adminRoute)
//
// The `requireOnboarded` gate runs BEFORE this router by virtue of
// being mounted on `/api/v1/*` in `apps/api/src/index.ts`, so an
// un-onboarded admin still hits the onboarding gate first.

import { Hono } from 'hono';
import type { RequireInternalUserEnv } from '../../../middleware/auth';
import { requireRole } from '../../../middleware/requireRole';
import { csvImportAdminRoute } from './csv-import';
import { invitationsAdminRoute } from './invitations';
import { orgAdminRoute } from './org';
import { rolloverAdminRoute } from './rollover';
import { rosterAdminRoute } from './roster';
import { teamsAdminRoute } from './teams';

export const adminRoute = new Hono<RequireInternalUserEnv>();

// 1) Gate every admin route behind the `org_admin` role. `dev_admin`
//    is admitted by the gate's short-circuit (platform-root role).
adminRoute.use('*', requireRole('org_admin'));

// 2) Mount the six feature sub-routers. Order is alphabetical to
//    match the directory listing — Hono does NOT match longest-prefix
//    first the way some routers do, but the six paths here are
//    disjoint so order does not affect matching.
adminRoute.route('/csv-import', csvImportAdminRoute);
adminRoute.route('/invitations', invitationsAdminRoute);
adminRoute.route('/org', orgAdminRoute);
adminRoute.route('/rollover', rolloverAdminRoute);
adminRoute.route('/roster', rosterAdminRoute);
adminRoute.route('/teams', teamsAdminRoute);
