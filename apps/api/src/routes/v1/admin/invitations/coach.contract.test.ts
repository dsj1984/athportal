// apps/api/src/routes/v1/admin/invitations/coach.contract.test.ts
//
// Contract test for the coach-invitation endpoint
// (Epic #10 / Story #664 / Task #684).
//
// Pins the wire-shape invariants for
// `POST /api/v1/admin/invitations/coach`:
//
//   1. Happy path — actor's org owns every named team. Returns 201
//      with `{ success: true, data: { id, email, role: 'coach',
//      teamIds, status: 'pending', createdAt } }`. The Clerk wrapper
//      is called with the actor's orgId, `role: 'coach'`, and the
//      full teamIds list. The local `invitations` row carries the
//      same triple plus the new Clerk id and is scoped to the actor's
//      org.
//
//   2. Cross-org isolation — actor from org A naming a team in org B
//      (even mixed with a team they own) is refused with `404
//      NOT_FOUND` (no cross-tenant existence oracle). No Clerk call
//      fires and no local row is inserted.
//
//   3. Missing team — actor's org but a teamId that does not exist
//      is also `404 NOT_FOUND`. Same wire shape as cross-org.
//
//   4. Empty teamIds — coach invitations require at least one team
//      per Epic body; `[]` is rejected with `400 INVALID_BODY`.
//
//   5. Invalid body — empty body, missing fields, or a forged `role`
//      field are rejected with `400 INVALID_BODY`.
//
// The migration list mirrors `athlete.contract.test.ts` so the schema
// rev stays in sync across the invitations contract surface.

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
  '0004_org_branding.sql',
  '0005_team_metadata.sql',
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
  readonly teamA2: string;
  readonly teamB1: string;
}

function seedGraph(db: ReturnType<typeof freshProductionDb>): Seed {
  const orgA = 'org_a';
  const orgB = 'org_b';
  const adminA = 'u_admin_a';
  const adminB = 'u_admin_b';
  const teamA1 = 'team_a1';
  const teamA2 = 'team_a2';
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
      { id: teamA2, orgId: orgA, name: 'Team A2' },
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

  return { orgA, orgB, adminA, adminB, teamA1, teamA2, teamB1 };
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
  readonly createCalls: { emailAddress: string; publicMetadata?: Record<string, unknown> }[];
  readonly revokeCalls: string[];
}

function makeClerkStub(): ClerkStub {
  const createCalls: { emailAddress: string; publicMetadata?: Record<string, unknown> }[] = [];
  const revokeCalls: string[] = [];
  let createCounter = 0;
  return {
    createCalls,
    revokeCalls,
    invitations: {
      createInvitation: vi.fn(
        (params: { emailAddress: string; publicMetadata?: Record<string, unknown> }) => {
          createCalls.push(params);
          createCounter += 1;
          return Promise.resolve({ id: `inv_clerk_new_${createCounter}` });
        },
      ),
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
    (c as unknown as { set: (k: string, v: unknown) => void }).set(
      'clerkInvitationClient',
      clerkClient,
    );
    await next();
  });
  app.route('/api/v1/admin/invitations', invitationsAdminRouter);
  return app;
}

describe('POST /api/v1/admin/invitations/coach — contract', () => {
  let clerk: ClerkStub;
  beforeEach(() => {
    clerk = makeClerkStub();
  });

  it('creates a coach invitation pinned to teams the actor owns', async () => {
    const db = freshProductionDb();
    const seed = seedGraph(db);
    const app = buildApp(db, actorFor(seed, 'A'), clerk);

    const res = await app.request('/api/v1/admin/invitations/coach', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'coach@test.invalid',
        teamIds: [seed.teamA1, seed.teamA2],
      }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      success: boolean;
      data: { id: string; email: string; role: string; teamIds: string[]; status: string };
    };
    expect(body.success).toBe(true);
    expect(body.data.email).toBe('coach@test.invalid');
    expect(body.data.role).toBe('coach');
    expect(body.data.teamIds).toEqual([seed.teamA1, seed.teamA2]);
    expect(body.data.status).toBe('pending');

    // Clerk was called with the actor's orgId, role, and teamIds in
    // publicMetadata so the accept webhook can reconstruct membership.
    expect(clerk.createCalls).toHaveLength(1);
    const call = clerk.createCalls[0];
    expect(call?.emailAddress).toBe('coach@test.invalid');
    expect(call?.publicMetadata).toMatchObject({
      orgId: seed.orgA,
      role: 'coach',
      teamIds: [seed.teamA1, seed.teamA2],
    });

    // DB side-effect: row persisted, scoped to the actor's org, with
    // the new Clerk id.
    const row = db.select().from(invitations).where(eq(invitations.id, body.data.id)).all()[0];
    expect(row?.orgId).toBe(seed.orgA);
    expect(row?.role).toBe('coach');
    expect(row?.teamIds).toEqual([seed.teamA1, seed.teamA2]);
    expect(row?.clerkInvitationId).toBe('inv_clerk_new_1');
    expect(row?.status).toBe('pending');
    expect(row?.invitedByUserId).toBe(seed.adminA);
  });

  it('refuses a teamIds list mixing same-org and cross-org with 404 NOT_FOUND', async () => {
    const db = freshProductionDb();
    const seed = seedGraph(db);
    // Actor is org A; teamB1 belongs to org B. Even one cross-org
    // entry trips the same 404 as a wholly-missing id.
    const app = buildApp(db, actorFor(seed, 'A'), clerk);

    const res = await app.request('/api/v1/admin/invitations/coach', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'coach@test.invalid',
        teamIds: [seed.teamA1, seed.teamB1],
      }),
    });

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({
      success: false,
      error: { code: 'NOT_FOUND' },
    });

    expect(clerk.createCalls).toHaveLength(0);
    expect(clerk.revokeCalls).toHaveLength(0);
    const rows = db.select().from(invitations).where(eq(invitations.orgId, seed.orgA)).all();
    expect(rows).toHaveLength(0);
  });

  it('refuses a wholly cross-org teamIds list with 404 NOT_FOUND', async () => {
    const db = freshProductionDb();
    const seed = seedGraph(db);
    const app = buildApp(db, actorFor(seed, 'A'), clerk);

    const res = await app.request('/api/v1/admin/invitations/coach', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'coach@test.invalid',
        teamIds: [seed.teamB1],
      }),
    });

    expect(res.status).toBe(404);
    expect(clerk.createCalls).toHaveLength(0);
  });

  it('returns 404 NOT_FOUND for a teamId that does not exist anywhere', async () => {
    const db = freshProductionDb();
    const seed = seedGraph(db);
    const app = buildApp(db, actorFor(seed, 'A'), clerk);

    const res = await app.request('/api/v1/admin/invitations/coach', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'coach@test.invalid',
        teamIds: ['team_does_not_exist'],
      }),
    });

    expect(res.status).toBe(404);
    expect(clerk.createCalls).toHaveLength(0);
  });

  it('rejects an empty teamIds array with 400 VALIDATION_ERROR-class INVALID_BODY', async () => {
    const db = freshProductionDb();
    const seed = seedGraph(db);
    const app = buildApp(db, actorFor(seed, 'A'), clerk);

    const res = await app.request('/api/v1/admin/invitations/coach', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'coach@test.invalid',
        teamIds: [],
      }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      success: false,
      error: { code: 'INVALID_BODY' },
    });
    expect(clerk.createCalls).toHaveLength(0);
  });

  it('rejects an empty body with 400 INVALID_BODY', async () => {
    const db = freshProductionDb();
    const seed = seedGraph(db);
    const app = buildApp(db, actorFor(seed, 'A'), clerk);

    const res = await app.request('/api/v1/admin/invitations/coach', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      success: false,
      error: { code: 'INVALID_BODY' },
    });
    expect(clerk.createCalls).toHaveLength(0);
  });

  it('rejects a forged role field with 400 INVALID_BODY (.strict())', async () => {
    const db = freshProductionDb();
    const seed = seedGraph(db);
    const app = buildApp(db, actorFor(seed, 'A'), clerk);

    const res = await app.request('/api/v1/admin/invitations/coach', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'coach@test.invalid',
        teamIds: [seed.teamA1],
        role: 'org_admin',
      }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      success: false,
      error: { code: 'INVALID_BODY' },
    });
    expect(clerk.createCalls).toHaveLength(0);
  });
});
