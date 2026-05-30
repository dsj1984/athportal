// apps/api/src/routes/v1/admin/invitations/lazy-client.contract.test.ts
//
// Pins the lazy-construction path for the invitations router
// (Story #970). The sibling contract tests (`coach`, `athlete`,
// `management`) inject a pre-seeded `clerkInvitationClient` stub via
// `c.set(...)` upstream of the router, which masks the production
// runtime path entirely — every Epic #10 invitation endpoint shipped
// red against `main` until Story #970 because the existing suite never
// exercised the no-stub branch.
//
// Two assertions matter here:
//
//   1. With a recognised `CLERK_SECRET_KEY` in env and NO upstream
//      stub, the router middleware constructs a `ClerkInvitationClient`
//      from `@clerk/backend` (mocked at module scope) and the create
//      endpoint proceeds past the `Invitation client unavailable.`
//      guard. The exact regression envelope MUST NOT surface.
//
//   2. With a missing / malformed `CLERK_SECRET_KEY` and no upstream
//      stub, the router refuses with the canonical 500 INTERNAL
//      envelope — same wire shape as the per-route defensive guard
//      pre-#970, but now sourced from the middleware so the failure
//      mode is uniform across all four create/resend/revoke routes.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  athleteMemberships,
  coachAssignments,
  invitations,
  organizations,
  teams,
  users,
} from '@repo/shared/db/schema';
import { type AuthContext, createTestApp } from '@repo/shared/testing';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequireInternalUserEnv } from '../../../../middleware/auth';
import { invitationsAdminRouter } from './router';

// Module-scope mock: every call to `createClerkClient` returns a stub
// whose `invitations.createInvitation` resolves to a fake Clerk id. The
// router's `asInvitationClient` wrapper passes the call through to this
// stub, so no real Clerk HTTP traffic fires.
const createInvitationMock = vi.fn(() => Promise.resolve({ id: 'inv_clerk_lazy_1' }));
const revokeInvitationMock = vi.fn(() => Promise.resolve({}));
vi.mock('@clerk/backend', () => ({
  createClerkClient: vi.fn(() => ({
    invitations: {
      createInvitation: createInvitationMock,
      revokeInvitation: revokeInvitationMock,
    },
  })),
}));

const MIGRATIONS_DIR = join(__dirname, '../../../../../../../packages/shared/src/db/migrations');
const MIGRATION_FILES = [
  '0000_auth_and_rbac.sql',
  '0001_onboarding_schema.sql',
  '0002_org_team_graph.sql',
  '0003_invitations.sql',
  '0004_org_branding.sql',
  '0005_team_metadata.sql',
  // Story #1054 / F33 — nullable first_name/last_name on users.
  '0010_users_name.sql',
];

function freshProductionDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  for (const file of MIGRATION_FILES) {
    const migration = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    for (const stmt of migration.split('--> statement-breakpoint').map((s) => s.trim())) {
      if (stmt.length > 0) sqlite.exec(stmt);
    }
  }
  return drizzle(sqlite, {
    schema: { users, organizations, teams, invitations, coachAssignments, athleteMemberships },
  });
}

interface Seed {
  readonly orgA: string;
  readonly adminA: string;
  readonly teamA1: string;
}

function seedGraph(db: ReturnType<typeof freshProductionDb>): Seed {
  const orgA = 'org_a';
  const adminA = 'u_admin_a';
  const teamA1 = 'team_a1';

  db.insert(organizations)
    .values([{ id: orgA, name: 'Org A', organizationType: 'CLUB' }])
    .run();
  db.insert(teams)
    .values([{ id: teamA1, orgId: orgA, name: 'Team A1' }])
    .run();
  db.insert(users)
    .values([
      {
        id: adminA,
        clerkSubjectId: 'user_admin_a',
        email: 'admin-a@test.invalid',
        role: 'org_admin',
        orgId: orgA,
      },
    ])
    .run();

  return { orgA, adminA, teamA1 };
}

function actorFor(seed: Seed): AuthContext {
  return {
    userId: seed.adminA,
    clerkSubjectId: 'user_admin_a',
    email: 'admin-a@test.invalid',
    role: 'org_admin',
    orgId: seed.orgA,
    teamId: null,
  };
}

/**
 * Build a test app that does NOT pre-seed `clerkInvitationClient`. The
 * router's lazy-construction middleware is the system under test.
 */
function buildAppNoStub(db: ReturnType<typeof freshProductionDb>, actor: AuthContext) {
  const app = createTestApp(db, { actor }) as unknown as Hono<RequireInternalUserEnv>;
  app.route('/api/v1/admin/invitations', invitationsAdminRouter);
  return app;
}

describe('admin invitations router — lazy clerkInvitationClient construction (Story #970)', () => {
  beforeEach(() => {
    createInvitationMock.mockClear();
    revokeInvitationMock.mockClear();
  });

  it('constructs the Clerk client from env on first call and proceeds past the unavailable guard', async () => {
    const db = freshProductionDb();
    const seed = seedGraph(db);
    const app = buildAppNoStub(db, actorFor(seed));

    const res = await app.request(
      '/api/v1/admin/invitations/coach',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: 'coach@test.invalid',
          teamIds: [seed.teamA1],
        }),
      },
      { CLERK_SECRET_KEY: 'sk_test_lazy_construction_fixture' },
    );

    // The exact regression envelope MUST NOT surface — that's the
    // wire-shape canary for the original 500 dead-router bug.
    const body = (await res.json()) as { success?: boolean; error?: { code?: string } };
    expect(body).not.toMatchObject({
      success: false,
      error: { code: 'INTERNAL' },
    });
    expect(res.status).toBe(201);
    expect(createInvitationMock).toHaveBeenCalledTimes(1);
  });

  it('refuses with 500 INTERNAL when CLERK_SECRET_KEY is absent', async () => {
    const db = freshProductionDb();
    const seed = seedGraph(db);
    const app = buildAppNoStub(db, actorFor(seed));

    const res = await app.request(
      '/api/v1/admin/invitations/coach',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: 'coach@test.invalid',
          teamIds: [seed.teamA1],
        }),
      },
      {
        /* no CLERK_SECRET_KEY */
      },
    );

    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({
      success: false,
      error: { code: 'INTERNAL', message: 'Invitation client unavailable.' },
    });
    expect(createInvitationMock).not.toHaveBeenCalled();
  });

  it('refuses with 500 INTERNAL when CLERK_SECRET_KEY is malformed', async () => {
    const db = freshProductionDb();
    const seed = seedGraph(db);
    const app = buildAppNoStub(db, actorFor(seed));

    const res = await app.request(
      '/api/v1/admin/invitations/coach',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: 'coach@test.invalid',
          teamIds: [seed.teamA1],
        }),
      },
      { CLERK_SECRET_KEY: 'not_a_clerk_key' },
    );

    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({
      success: false,
      error: { code: 'INTERNAL', message: 'Invitation client unavailable.' },
    });
    expect(createInvitationMock).not.toHaveBeenCalled();
  });
});
