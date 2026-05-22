// apps/api/src/routes/v1/admin/invitations/management.contract.test.ts
//
// Contract test for the GET/resend/revoke surface (Epic #10 / Story
// #655 / Task #668).
//
// Pins five wire-shape invariants:
//
//   1. GET / returns 200 with `{ success: true, data: [...] }`
//      containing only the actor's org's pending invitations.
//   2. POST /:id/resend returns 200, calls the Clerk wrapper's
//      revoke+create pair, and updates the local row's
//      `clerk_invitation_id` to the new id. Status stays 'pending'.
//   3. POST /:id/revoke returns 200, calls the Clerk wrapper's
//      revoke verb, flips the local row's status to 'revoked', and
//      the row is excluded from a subsequent GET /.
//   4. A cross-tenant probe (an org_admin from org A naming a row
//      owned by org B) is refused with 403 FORBIDDEN — same wire
//      shape as an RBAC denial. The row is NOT mutated. Covers
//      list, resend, and revoke surfaces.
//   5. The list endpoint excludes invitations whose status is
//      `accepted` or `revoked`.

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
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClerkInvitationClient } from '../../../../lib/clerk-invitations';
import type { RequireInternalUserEnv } from '../../../../middleware/auth';
import { invitationsAdminRouter } from './router';

const MIGRATIONS_DIR = join(__dirname, '../../../../../../../packages/shared/src/db/migrations');
const MIGRATION_FILES = [
  '0000_auth_and_rbac.sql',
  '0001_onboarding_schema.sql',
  '0002_org_team_graph.sql',
  '0003_invitations.sql',
  '0004_team_metadata.sql',
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
  readonly orgB: string;
  readonly adminA: string;
  readonly adminB: string;
  readonly teamA1: string;
  readonly teamB1: string;
}

function seedGraph(db: ReturnType<typeof freshProductionDb>): Seed {
  const orgA = 'org_a';
  const orgB = 'org_b';
  const adminA = 'u_admin_a';
  const adminB = 'u_admin_b';
  const teamA1 = 'team_a1';
  const teamB1 = 'team_b1';

  db.insert(organizations)
    .values([
      { id: orgA, name: 'Org A', organizationType: 'CLUB' },
      { id: orgB, name: 'Org B', organizationType: 'CLUB' },
    ])
    .run();
  db.insert(teams)
    .values([
      { id: teamA1, orgId: orgA, name: 'Team A1' },
      { id: teamB1, orgId: orgB, name: 'Team B1' },
    ])
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
      {
        id: adminB,
        clerkSubjectId: 'user_admin_b',
        email: 'admin-b@test.invalid',
        role: 'org_admin',
        orgId: orgB,
      },
    ])
    .run();

  return { orgA, orgB, adminA, adminB, teamA1, teamB1 };
}

function actorFor(seed: Seed, which: 'A' | 'B'): AuthContext {
  return {
    userId: which === 'A' ? seed.adminA : seed.adminB,
    clerkSubjectId: which === 'A' ? 'user_admin_a' : 'user_admin_b',
    email: which === 'A' ? 'admin-a@test.invalid' : 'admin-b@test.invalid',
    role: 'org_admin',
    orgId: which === 'A' ? seed.orgA : seed.orgB,
    teamId: null,
  };
}

interface ClerkStub extends ClerkInvitationClient {
  readonly createCalls: { emailAddress: string }[];
  readonly revokeCalls: string[];
}

function makeClerkStub(): ClerkStub {
  const createCalls: { emailAddress: string }[] = [];
  const revokeCalls: string[] = [];
  let createCounter = 0;
  return {
    createCalls,
    revokeCalls,
    invitations: {
      createInvitation: vi.fn((params: { emailAddress: string }) => {
        createCalls.push(params);
        createCounter += 1;
        return Promise.resolve({ id: `inv_clerk_new_${createCounter}` });
      }),
      revokeInvitation: vi.fn((id: string) => {
        revokeCalls.push(id);
        return Promise.resolve({});
      }),
    },
  };
}

function buildApp(
  db: ReturnType<typeof freshProductionDb>,
  actor: AuthContext,
  clerkClient: ClerkInvitationClient,
) {
  const app = createTestApp(db, { actor }) as unknown as Hono<RequireInternalUserEnv>;
  app.use('*', async (c, next) => {
    // The router types its client variable on its own env extension —
    // set via the underlying Hono context API so the test does not need
    // to re-export the augmented env from `router.ts`.
    (c as unknown as { set: (k: string, v: unknown) => void }).set(
      'clerkInvitationClient',
      clerkClient,
    );
    await next();
  });
  app.route('/api/v1/admin/invitations', invitationsAdminRouter);
  return app;
}

describe('admin invitations management — contract', () => {
  let clerk: ClerkStub;
  beforeEach(() => {
    clerk = makeClerkStub();
  });

  it('GET / returns pending invitations scoped to the actor org', async () => {
    const db = freshProductionDb();
    const seed = seedGraph(db);

    db.insert(invitations)
      .values([
        {
          id: 'inv_a_pending_1',
          orgId: seed.orgA,
          email: 'invitee-a-1@test.invalid',
          role: 'coach',
          teamIds: [seed.teamA1],
          clerkInvitationId: 'inv_clerk_a_1',
          status: 'pending',
          invitedByUserId: seed.adminA,
        },
        {
          id: 'inv_a_accepted_1',
          orgId: seed.orgA,
          email: 'invitee-a-2@test.invalid',
          role: 'coach',
          teamIds: [seed.teamA1],
          clerkInvitationId: 'inv_clerk_a_2',
          status: 'accepted',
          invitedByUserId: seed.adminA,
        },
        {
          id: 'inv_b_pending_1',
          orgId: seed.orgB,
          email: 'invitee-b-1@test.invalid',
          role: 'athlete',
          teamIds: [seed.teamB1],
          clerkInvitationId: 'inv_clerk_b_1',
          status: 'pending',
          invitedByUserId: seed.adminB,
        },
      ])
      .run();

    const app = buildApp(db, actorFor(seed, 'A'), clerk);
    const res = await app.request('/api/v1/admin/invitations', { method: 'GET' });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: { id: string }[] };
    expect(body.success).toBe(true);
    const ids = body.data.map((r) => r.id).sort();
    expect(ids).toEqual(['inv_a_pending_1']);
  });

  it('POST /:id/resend revokes the old Clerk row, creates a new one, and updates the local clerk_invitation_id', async () => {
    const db = freshProductionDb();
    const seed = seedGraph(db);

    db.insert(invitations)
      .values({
        id: 'inv_resend_1',
        orgId: seed.orgA,
        email: 'invitee-resend@test.invalid',
        role: 'coach',
        teamIds: [seed.teamA1],
        clerkInvitationId: 'inv_clerk_old',
        status: 'pending',
        invitedByUserId: seed.adminA,
      })
      .run();

    const app = buildApp(db, actorFor(seed, 'A'), clerk);
    const res = await app.request('/api/v1/admin/invitations/inv_resend_1/resend', {
      method: 'POST',
    });

    expect(res.status).toBe(200);
    expect(clerk.revokeCalls).toEqual(['inv_clerk_old']);
    expect(clerk.createCalls).toHaveLength(1);

    const row = db.select().from(invitations).where(eq(invitations.id, 'inv_resend_1')).all()[0];
    expect(row?.clerkInvitationId).toBe('inv_clerk_new_1');
    expect(row?.status).toBe('pending');
  });

  it('POST /:id/revoke flips the local status to revoked and excludes the row from the next GET /', async () => {
    const db = freshProductionDb();
    const seed = seedGraph(db);

    db.insert(invitations)
      .values({
        id: 'inv_revoke_1',
        orgId: seed.orgA,
        email: 'invitee-revoke@test.invalid',
        role: 'coach',
        teamIds: [seed.teamA1],
        clerkInvitationId: 'inv_clerk_revoke',
        status: 'pending',
        invitedByUserId: seed.adminA,
      })
      .run();

    const app = buildApp(db, actorFor(seed, 'A'), clerk);
    const revokeRes = await app.request('/api/v1/admin/invitations/inv_revoke_1/revoke', {
      method: 'POST',
    });
    expect(revokeRes.status).toBe(200);
    expect(clerk.revokeCalls).toEqual(['inv_clerk_revoke']);

    const row = db.select().from(invitations).where(eq(invitations.id, 'inv_revoke_1')).all()[0];
    expect(row?.status).toBe('revoked');

    const listRes = await app.request('/api/v1/admin/invitations', { method: 'GET' });
    const listBody = (await listRes.json()) as { data: { id: string }[] };
    expect(listBody.data).toHaveLength(0);
  });

  it('refuses cross-tenant list/resend/revoke with 403 FORBIDDEN and does not mutate the row', async () => {
    const db = freshProductionDb();
    const seed = seedGraph(db);

    db.insert(invitations)
      .values({
        id: 'inv_b_only',
        orgId: seed.orgB,
        email: 'invitee-b@test.invalid',
        role: 'coach',
        teamIds: [seed.teamB1],
        clerkInvitationId: 'inv_clerk_b_only',
        status: 'pending',
        invitedByUserId: seed.adminB,
      })
      .run();

    // Actor from org A — but the row is owned by org B.
    const app = buildApp(db, actorFor(seed, 'A'), clerk);

    const listRes = await app.request('/api/v1/admin/invitations', { method: 'GET' });
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as { data: unknown[] };
    expect(listBody.data).toHaveLength(0);

    const resendRes = await app.request('/api/v1/admin/invitations/inv_b_only/resend', {
      method: 'POST',
    });
    expect(resendRes.status).toBe(403);
    expect(await resendRes.json()).toMatchObject({
      success: false,
      error: { code: 'FORBIDDEN' },
    });

    const revokeRes = await app.request('/api/v1/admin/invitations/inv_b_only/revoke', {
      method: 'POST',
    });
    expect(revokeRes.status).toBe(403);
    expect(await revokeRes.json()).toMatchObject({
      success: false,
      error: { code: 'FORBIDDEN' },
    });

    // No Clerk call MUST have fired for the cross-tenant probe.
    expect(clerk.revokeCalls).toHaveLength(0);
    expect(clerk.createCalls).toHaveLength(0);

    // Persisted row remains untouched.
    const row = db.select().from(invitations).where(eq(invitations.id, 'inv_b_only')).all()[0];
    expect(row?.status).toBe('pending');
    expect(row?.clerkInvitationId).toBe('inv_clerk_b_only');
  });
});
