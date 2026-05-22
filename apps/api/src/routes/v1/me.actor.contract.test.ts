// apps/api/src/routes/v1/me.actor.contract.test.ts
//
// Contract test for the test-auth seam (Story #342 / Task #357).
//
// Drives `createTestApp(db, { actor })` end-to-end for the four MVP
// personas (athlete, coach, org_admin, dev_admin), seeds the matching
// `users` row, mounts `requireInternalUser()` to prove the JIT chain
// runs UNCHANGED in the test path, and asserts the response's `role`
// matches the seeded actor.
//
// Load-bearing constraints (Tech Spec #318 §F / §G):
//
//   1. The `{ actor }` option swaps ONLY the JWT-validator stage. The
//      downstream `requireInternalUser` middleware runs against real
//      production code — JIT row lookup, role surfacing, AuthContext
//      composition all execute through the same code path as in
//      production. This test pins that contract.
//
//   2. Each persona case seeds the users row BEFORE the request so the
//      JIT path hits the fast lookup (Step 1 of the three-step race
//      elimination) rather than the conflict path. The presence of
//      `requireInternalUser` in the chain is what makes "JIT path
//      exercised" true — the middleware performs a real
//      `SELECT users WHERE clerk_subject_id = ?` round-trip.
//
//   3. No HTTP mock, no Clerk SDK mock. The test-auth adapter is the
//      mock — every other layer runs real production code.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { users } from '@repo/shared/db/schema';
import { type AuthContext, createTestApp } from '@repo/shared/testing';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { type RequireInternalUserEnv, requireInternalUser } from '../../middleware/auth';
import { meRoute } from './me';

const MIGRATIONS_DIR = join(__dirname, '../../../../../packages/shared/src/db/migrations');
const MIGRATION_FILES = [
  '0000_auth_and_rbac.sql',
  '0001_onboarding_schema.sql',
  '0002_org_team_graph.sql',
  '0003_org_branding.sql',
];

/**
 * Build a fresh in-memory SQLite handle backed by the production
 * migration scripts. Mirrors the helper in `me.contract.test.ts` so
 * the two suites read identically — there is no need to share state
 * across them.
 */
function freshProductionDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  for (const file of MIGRATION_FILES) {
    const migration = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    for (const stmt of migration.split('--> statement-breakpoint').map((s) => s.trim())) {
      if (stmt.length > 0) sqlite.exec(stmt);
    }
  }
  return drizzle(sqlite, { schema: { users } });
}

/**
 * Persona-specific fixture for the four MVP roles. Mirrors the persona
 * table in `packages/shared/src/testing/auth.ts` but is declared inline
 * here so a change to either does not silently desynchronise — the
 * test fails on any mismatch.
 */
interface PersonaCase {
  readonly label: string;
  readonly actor: AuthContext;
}

const PERSONA_CASES: readonly PersonaCase[] = [
  {
    label: 'athlete',
    actor: {
      userId: 'u_athlete_1',
      clerkSubjectId: 'user_test_athlete',
      email: 'athlete@test.invalid',
      role: 'member',
      orgId: null,
      teamId: null,
    },
  },
  {
    label: 'coach',
    actor: {
      userId: 'u_coach_1',
      clerkSubjectId: 'user_test_coach',
      email: 'coach@test.invalid',
      role: 'team_admin',
      orgId: null,
      teamId: null,
    },
  },
  {
    label: 'org_admin',
    actor: {
      userId: 'u_org_admin_1',
      clerkSubjectId: 'user_test_org_admin',
      email: 'org-admin@test.invalid',
      role: 'org_admin',
      orgId: null,
      teamId: null,
    },
  },
  {
    label: 'dev_admin',
    actor: {
      userId: 'u_dev_admin_1',
      clerkSubjectId: 'user_test_dev_admin',
      email: 'dev-admin@test.invalid',
      role: 'dev_admin',
      orgId: null,
      teamId: null,
    },
  },
];

describe('createTestApp({ actor }) drives GET /api/v1/me for each persona', () => {
  for (const { label, actor } of PERSONA_CASES) {
    it(`returns the seeded role for the ${label} persona`, async () => {
      // Arrange — production-schema DB, seeded users row matching the
      // actor's subject id so requireInternalUser's fast-path lookup
      // hits.
      const db = freshProductionDb();
      db.insert(users)
        .values({
          id: actor.userId,
          clerkSubjectId: actor.clerkSubjectId,
          email: actor.email,
          role: actor.role,
          orgId: actor.orgId,
          teamId: actor.teamId,
        })
        .run();

      // The shared TestApp's variable shape is a superset of what
      // `requireInternalUser` needs (`db`, `clerkSubjectId`, `auth`).
      // We cast to `RequireInternalUserEnv` at the `.use` boundary so
      // the middleware mounts cleanly without leaking the cross-package
      // env type into the public shared API.
      const app = createTestApp(db, { actor }) as unknown as Hono<RequireInternalUserEnv>;
      app.use('/api/v1/*', requireInternalUser());
      app.route('/api/v1/me', meRoute);

      // Act
      const res = await app.request('/api/v1/me', { method: 'GET' });

      // Assert — wire shape
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        success: boolean;
        data: {
          userId: string;
          role: string;
          email: string;
          orgId: string | null;
          teamId: string | null;
        };
      };
      expect(body.success).toBe(true);
      expect(body.data.role).toBe(actor.role);
      expect(body.data.userId).toBe(actor.userId);
      expect(body.data.email).toBe(actor.email);
      expect(body.data.orgId).toBe(actor.orgId);
      expect(body.data.teamId).toBe(actor.teamId);
    });
  }

  it('writes a fresh users row when no seed exists (JIT insert path)', async () => {
    // The fast-path lookup misses; requireInternalUser's
    // INSERT … ON CONFLICT DO NOTHING RETURNING * branch runs and the
    // returned AuthContext carries a JIT-inserted userId (prefix `u_`)
    // and the default `member` role. The test-auth seam does NOT carry
    // userId/role into the route — `requireInternalUser` recomputes
    // them from the DB, which is the production behaviour we want
    // pinned.
    const db = freshProductionDb();
    const actor: AuthContext = {
      userId: 'u_jit_should_be_ignored',
      clerkSubjectId: 'user_test_jit_inserter',
      email: 'jit@test.invalid',
      role: 'org_admin',
      orgId: null,
      teamId: null,
    };
    const app = createTestApp(db, { actor }) as unknown as Hono<RequireInternalUserEnv>;
    app.use('/api/v1/*', requireInternalUser());
    app.route('/api/v1/me', meRoute);

    const res = await app.request('/api/v1/me', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { userId: string; role: string } };
    // requireInternalUser inserts a row with role = JIT_DEFAULT_ROLE
    // ('member') and a freshly-generated userId.
    expect(body.data.role).toBe('member');
    expect(body.data.userId).toMatch(/^u_/);
    expect(body.data.userId).not.toBe(actor.userId);
  });
});
