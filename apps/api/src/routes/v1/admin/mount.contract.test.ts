// apps/api/src/routes/v1/admin/mount.contract.test.ts
//
// Contract test for the `/api/v1/admin` mount in `apps/api/src/index.ts`
// (Story #654, Task #660, Epic #10).
//
// Pins the wire shape across the full production auth chain:
//
//   1. Anonymous request to `/api/v1/admin/org` → 401 UNAUTHENTICATED
//      (the `clerkAuth` gate, which runs first on `*`).
//   2. Authenticated non-admin request to `/api/v1/admin/org` → 403
//      FORBIDDEN (the `requireRole('org_admin')` gate, which runs
//      inside the admin router AFTER `requireInternalUser` and
//      `requireOnboarded`).
//
// The anonymous-401 case exercises the real `app` from `./index.ts`
// because that path does not need a database — `clerkAuth` rejects
// before any `c.var.db` access. The 403 case builds a parallel
// composition that mirrors `index.ts` line-for-line (test-auth seam
// substitutes the JWT validator, every other middleware is the real
// production module) — the same pattern used by
// `apps/api/src/middleware/require-onboarded.contract.test.ts`.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { organizations, teams, users } from '@repo/shared/db/schema';
import { type AuthContext, createTestApp } from '@repo/shared/testing';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { app } from '../../../index';
import { type RequireInternalUserEnv, requireInternalUser } from '../../../middleware/auth';
import { requireOnboarded } from '../../../middleware/requireOnboarded';
import { adminRoute } from './index';

const MIGRATIONS_DIR = join(__dirname, '../../../../../../packages/shared/src/db/migrations');

function freshOnboardingProdDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  for (const file of [
    '0000_auth_and_rbac.sql',
    '0001_onboarding_schema.sql',
    '0002_org_team_graph.sql',
    '0003_invitations.sql',
    '0004_org_branding.sql',
    '0005_team_metadata.sql',
  ]) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    for (const stmt of sql.split('--> statement-breakpoint').map((s) => s.trim())) {
      if (stmt.length > 0) sqlite.exec(stmt);
    }
  }
  return drizzle(sqlite, { schema: { users } });
}

function actor(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: 'u_mount_actor',
    clerkSubjectId: 'user_mount_subject',
    email: 'actor@test.invalid',
    role: 'member',
    orgId: 'org_test_a',
    teamId: null,
    ...overrides,
  };
}

function seedActor(
  db: ReturnType<typeof freshOnboardingProdDb>,
  a: AuthContext,
  onboardedAt: Date | null,
) {
  // Seed the org / team FK targets when the actor declares them, so the
  // `users` row's foreign-key constraints succeed against the prod
  // schema (Story #594 added the FK from `users.org_id` / `users.team_id`
  // into `organizations.id` / `teams.id`). The placeholder rows carry
  // synthetic names — the gate's policy decision does not read them.
  if (a.orgId) {
    db.insert(organizations)
      .values({ id: a.orgId, name: 'Test Org', organizationType: 'CLUB' })
      .onConflictDoNothing()
      .run();
  }
  if (a.teamId) {
    // `teams.org_id` is `notNull` — the actor MUST also declare an org
    // when it declares a team. The test's actor() helper guarantees this.
    if (!a.orgId) {
      throw new Error('seedActor: actor with teamId must also declare orgId');
    }
    db.insert(teams)
      .values({ id: a.teamId, orgId: a.orgId, name: 'Test Team' })
      .onConflictDoNothing()
      .run();
  }
  db.insert(users)
    .values({
      id: a.userId,
      clerkSubjectId: a.clerkSubjectId,
      email: a.email,
      role: a.role,
      orgId: a.orgId,
      teamId: a.teamId,
      onboardedAt,
      ageAttestedAt: onboardedAt,
    })
    .run();
}

/**
 * Build the contract harness for the authenticated 403 path. Mirrors
 * the production middleware composition from `apps/api/src/index.ts`:
 *
 *   test-auth seam (createTestApp({ actor })) → requireInternalUser
 *   → requireOnboarded → adminRoute (which gates with requireRole)
 *
 * The test-auth seam swaps ONLY the JWT-validator stage; every other
 * middleware is the real production module.
 */
function buildAuthChain(
  db: ReturnType<typeof freshOnboardingProdDb>,
  a: AuthContext,
): Hono<RequireInternalUserEnv> {
  const harness = createTestApp(db, { actor: a }) as unknown as Hono<RequireInternalUserEnv>;
  harness.use('/api/v1/*', requireInternalUser());
  harness.use('/api/v1/*', requireOnboarded());
  harness.route('/api/v1/admin', adminRoute);
  return harness;
}

const stubEnv = {
  ANALYTICS: { writeDataPoint: () => undefined },
};

describe('/api/v1/admin mount — contract', () => {
  it('returns 401 UNAUTHENTICATED for an anonymous request to /api/v1/admin/org', async () => {
    // No cookie, no Authorization header — clerkAuth's first guard
    // (missing-token branch) returns 401 with the canonical envelope.
    const res = await app.request('/api/v1/admin/org', { method: 'GET' }, stubEnv);

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({
      success: false,
      error: { code: 'UNAUTHENTICATED' },
    });
  });

  it('returns 403 FORBIDDEN for an authenticated non-admin actor on /api/v1/admin/org', async () => {
    const db = freshOnboardingProdDb();
    const a = actor({ role: 'member', orgId: 'org_test_a' });
    seedActor(db, a, new Date('2026-05-01T00:00:00.000Z'));

    const harness = buildAuthChain(db, a);

    const res = await harness.request('/api/v1/admin/org', { method: 'GET' });

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      success: false,
      error: { code: 'FORBIDDEN' },
    });
  });

  it('returns 403 FORBIDDEN for an authenticated team_admin on /api/v1/admin/teams', async () => {
    const db = freshOnboardingProdDb();
    const a = actor({ role: 'team_admin', orgId: 'org_test_a', teamId: 'team_test_1' });
    seedActor(db, a, new Date('2026-05-01T00:00:00.000Z'));

    const harness = buildAuthChain(db, a);

    const res = await harness.request('/api/v1/admin/teams', { method: 'GET' });

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      success: false,
      error: { code: 'FORBIDDEN' },
    });
  });

  // Story #656/#657/#663 replaced the org / teams / csv-import
  // placeholders; Story #665 (Epic #10) replaced the rollover
  // placeholder. Every admin sub-router is now real, so the
  // passthrough proof targets a real read endpoint
  // (`/api/v1/admin/teams`) and asserts the request reached the
  // handler — a 200 envelope is the only honest signal we can
  // assert here without re-pinning a downstream handler's wire shape.
  it('passes an authenticated onboarded org_admin through to a real admin handler', async () => {
    const db = freshOnboardingProdDb();
    const a = actor({ role: 'org_admin', orgId: 'org_test_a' });
    seedActor(db, a, new Date('2026-05-01T00:00:00.000Z'));

    const harness = buildAuthChain(db, a);

    const res = await harness.request('/api/v1/admin/teams', { method: 'GET' });

    // 200 envelope from the real teams list handler is proof the
    // auth chain admitted the request past the role gate.
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true });
  });
});
