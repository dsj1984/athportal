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
// its dedicated contract test is `./teams.contract.test.ts`. The three
// remaining mount points are still placeholders.
const SUB_ROUTES = [
  { path: '/api/v1/admin/csv-import', feature: 'CSV import' },
  { path: '/api/v1/admin/rollover', feature: 'rollover' },
  { path: '/api/v1/admin/roster', feature: 'roster' },
] as const;

describe('admin router scaffold — contract', () => {
  describe('placeholder sub-routers respond 501 NOT_IMPLEMENTED to an admitted actor', () => {
    for (const { path, feature } of SUB_ROUTES) {
      it(`${path} returns 501 NOT_IMPLEMENTED for org_admin`, async () => {
        const a = actor({ role: 'org_admin' });
        const app = buildApp(a);

        const res = await app.request(path, { method: 'GET' });

        expect(res.status).toBe(501);
        const body = (await res.json()) as {
          success: boolean;
          error: { code: string; message: string };
        };
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('NOT_IMPLEMENTED');
        expect(body.error.message).toContain(feature);
      });
    }
  });

  it('placeholder responds 501 for any HTTP verb (POST, PATCH, DELETE)', async () => {
    const a = actor({ role: 'org_admin' });
    const app = buildApp(a);

    for (const method of ['POST', 'PATCH', 'DELETE'] as const) {
      const res = await app.request('/api/v1/admin/csv-import', { method });
      expect(res.status).toBe(501);
      expect(await res.json()).toMatchObject({
        success: false,
        error: { code: 'NOT_IMPLEMENTED' },
      });
    }
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

    const res = await app.request('/api/v1/admin/csv-import', { method: 'GET' });

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      success: false,
      error: { code: 'FORBIDDEN' },
    });
  });

  it('admits a dev_admin actor to every sub-router (platform-root short-circuit)', async () => {
    const a = actor({ role: 'dev_admin', orgId: null });
    const app = buildApp(a);

    for (const { path } of SUB_ROUTES) {
      const res = await app.request(path, { method: 'GET' });
      expect(res.status).toBe(501);
      expect(await res.json()).toMatchObject({
        success: false,
        error: { code: 'NOT_IMPLEMENTED' },
      });
    }
  });
});
