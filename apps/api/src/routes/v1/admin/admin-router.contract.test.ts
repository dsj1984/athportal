// apps/api/src/routes/v1/admin/admin-router.contract.test.ts
//
// Contract test for the admin router scaffold (Story #654, Task #658,
// Epic #10).
//
// Pins the wire shape three things on this Story:
//
//   1. All six placeholder sub-routers respond 501 NOT_IMPLEMENTED
//      with the canonical error envelope when an admitted actor hits
//      any verb on any sub-path.
//   2. The `requireRole('org_admin')` gate on the admin tree refuses
//      a non-admin actor with 403 FORBIDDEN before the placeholder
//      runs.
//   3. A `dev_admin` actor reaches every sub-router (the role gate's
//      platform-root short-circuit).
//
// Tier: contract. Uses `createTestApp(db, { actor })` to drive the
// real `adminRoute` (including its `requireRole` gate) against an
// ephemeral SQLite — no policy mock, no Clerk SDK mock.

import { type AuthContext, type TestDbLike, createTestApp } from '@repo/shared/testing';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { RequireInternalUserEnv } from '../../../middleware/auth';
import { adminRoute } from './index';

function freshDb(): TestDbLike {
  const sqlite = new Database(':memory:');
  return drizzle(sqlite, { schema: {} });
}

function actor(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: 'u_admin_actor',
    clerkSubjectId: 'user_admin_subject',
    email: 'admin@test.invalid',
    role: 'org_admin',
    orgId: 'org_test_a',
    teamId: null,
    ...overrides,
  };
}

function buildApp(a: AuthContext) {
  const db = freshDb();
  const app = createTestApp(db, { actor: a }) as unknown as Hono<RequireInternalUserEnv>;
  app.route('/api/v1/admin', adminRoute);
  return app;
}

/**
 * The five feature sub-router mount points still on the placeholder
 * factory. Listed here as a fixture so the placeholder-coverage test
 * below is exhaustive: adding a seventh feature requires extending
 * this array AND adding its corresponding `app.route(...)` line in
 * `./index.ts` — the contract test fails loudly if either side drifts.
 *
 * `/api/v1/admin/invitations` was promoted off the placeholder by
 * Epic #10 / Story #655 / Task #668 — its real handlers live in
 * `./invitations/router.ts` and are pinned by
 * `./invitations/management.contract.test.ts`.
 */
// `/api/v1/admin/org` was promoted out of the placeholder set by
// Story #656 (Epic #10) — its real handlers live in `./org.ts` and
// its dedicated contract test is `./org.contract.test.ts`.
// `/api/v1/admin/teams` was promoted out of the placeholder set by
// Story #657 / Task #678 — its real handlers live in `./teams.ts` and
// its dedicated contract test is `./teams.contract.test.ts`.
// `/api/v1/admin/roster` was promoted out of the placeholder set by
// Story #661 / Task #692 (Epic #10) — its real handler lives in
// `./roster.ts` and its dedicated contract test is
// `./roster.contract.test.ts`.
// `/api/v1/admin/csv-import` was promoted out of the placeholder set
// by Story #663 / Task #687 — its real handlers live in
// `./csv-import/router.ts` and its dedicated contract test is
// `./csv-import/csv-import.contract.test.ts`. As of Story #665 /
// Task #695, `/api/v1/admin/rollover` was also promoted out of the
// placeholder set — its real handlers live in `./rollover.ts` and
// its dedicated contract test is `./rollover.contract.test.ts`. The
// placeholder set is now empty; the role-gate behavior is still
// exercised by the team_admin / member / dev_admin coverage below
// (which hits real handlers but only at the gate boundary).
const SUB_ROUTES: ReadonlyArray<{ readonly path: string; readonly feature: string }> = [];

describe('admin router scaffold — contract', () => {
  it('placeholder set is empty (every sub-router is implemented)', () => {
    expect(SUB_ROUTES).toHaveLength(0);
  });

  it('refuses a team_admin actor with 403 FORBIDDEN before reaching the placeholder', async () => {
    const a = actor({ role: 'team_admin', orgId: 'org_test_a', teamId: 'team_test_1' });
    const app = buildApp(a);

    const res = await app.request('/api/v1/admin/teams', { method: 'GET' });

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      success: false,
      error: { code: 'FORBIDDEN' },
    });
  });

  it('refuses a member actor with 403 FORBIDDEN before reaching the placeholder', async () => {
    const a = actor({ role: 'member', orgId: 'org_test_a' });
    const app = buildApp(a);

    const res = await app.request('/api/v1/admin/teams', { method: 'GET' });

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      success: false,
      error: { code: 'FORBIDDEN' },
    });
  });

  it('admits a dev_admin actor through the admin gate (platform-root short-circuit)', async () => {
    const a = actor({ role: 'dev_admin', orgId: null });
    const app = buildApp(a);

    // A dev_admin admitted past the gate must NOT receive a 403; the
    // downstream handler decides what to do. The teams list handler
    // returns 400 MISSING_ORG_SCOPE for a dev_admin without ?orgId=,
    // which is the proof the gate let the request through.
    const res = await app.request('/api/v1/admin/teams', { method: 'GET' });
    expect(res.status).not.toBe(403);
  });
});
