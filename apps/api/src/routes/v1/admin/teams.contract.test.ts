// apps/api/src/routes/v1/admin/teams.contract.test.ts
//
// Contract test for `/api/v1/admin/teams` (Epic #10 / Story #657 /
// Task #678).
//
// Pins the wire shape AND the cross-tenant isolation invariants for
// every Team CRUD endpoint:
//
//   - GET    /                     happy path (active + archived
//                                  filters) + DB side-effect
//   - POST   /                     201 + canonical envelope + DB row
//                                  visible in actor's org
//   - PATCH  /:id                  200 + DB column updated
//   - POST   /:id/archive          200 + DB archived_at stamped, row
//                                  excluded from default list
//   - POST   /:id/restore          200 + DB archived_at cleared
//   - INVALID_BODY                 Zod boundary rejects bad payloads
//   - 404 NOT_FOUND                Unknown id in same org
//   - Cross-org isolation matrix   Org A admin sees 404 (never 403) on
//                                  org B's team for read / patch /
//                                  archive / restore.
//
// Composition: real `teamsAdminRoute` mounted at `/api/v1/admin/teams`
// against the test-auth seam (`createTestApp(db, { actor })`). The
// `requireRole('org_admin')` gate from `./index.ts` is NOT in the chain
// here — its behavior is exhaustively covered by
// `./admin-router.contract.test.ts` and `./mount.contract.test.ts`.
// Mounting the bare route lets this test focus on the handler-level
// invariants without re-asserting the gate.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { organizations, teams } from '@repo/shared/db/schema';
import { type AuthContext, createTestApp } from '@repo/shared/testing';
import Database from 'better-sqlite3';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';
import type { RequireInternalUserEnv } from '../../../middleware/auth';
import { teamsAdminRoute } from './teams';

const MIGRATIONS_DIR = join(__dirname, '../../../../../../packages/shared/src/db/migrations');

function freshTeamsDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  for (const file of [
    '0000_auth_and_rbac.sql',
    '0001_onboarding_schema.sql',
    '0002_org_team_graph.sql',
    '0003_invitations.sql',
    '0004_team_metadata.sql',
  ]) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    for (const stmt of sql.split('--> statement-breakpoint').map((s) => s.trim())) {
      if (stmt.length > 0) sqlite.exec(stmt);
    }
  }
  return drizzle(sqlite, { schema: { organizations, teams } });
}

type TeamsDb = ReturnType<typeof freshTeamsDb>;

const ORG_A = 'org_a_test';
const ORG_B = 'org_b_test';

function actor(orgId: string, overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: `u_admin_${orgId}`,
    clerkSubjectId: `user_test_${orgId}`,
    email: `admin-${orgId}@test.invalid`,
    role: 'org_admin',
    orgId,
    teamId: null,
    ...overrides,
  };
}

function seedOrg(db: TeamsDb, id: string): void {
  db.insert(organizations)
    .values({ id, name: `Org ${id}`, organizationType: 'CLUB' })
    .onConflictDoNothing()
    .run();
}

interface SeedTeamOpts {
  id?: string;
  name?: string;
  sport?: string;
  season?: string;
  ageGroup?: string;
  archivedAt?: Date | null;
}

function seedTeam(db: TeamsDb, orgId: string, opts: SeedTeamOpts = {}): string {
  const id = opts.id ?? `t_${orgId}_${Math.random().toString(36).slice(2, 8)}`;
  db.insert(teams)
    .values({
      id,
      orgId,
      name: opts.name ?? 'Default Name',
      sport: opts.sport ?? 'Volleyball',
      season: opts.season ?? 'Fall 2026',
      ageGroup: opts.ageGroup ?? 'U14',
      archivedAt: opts.archivedAt ?? null,
    })
    .run();
  return id;
}

function buildApp(db: TeamsDb, a: AuthContext) {
  const harness = createTestApp(db, { actor: a }) as unknown as Hono<RequireInternalUserEnv>;
  harness.route('/api/v1/admin/teams', teamsAdminRoute);
  return harness;
}

const STUB_ENV = { ANALYTICS: { writeDataPoint: () => undefined } };

beforeEach(() => {
  // No-op — each test builds its own DB instance via `freshTeamsDb()`.
});

describe('GET /api/v1/admin/teams — list', () => {
  it('returns the active teams scoped to the actor org', async () => {
    const db = freshTeamsDb();
    seedOrg(db, ORG_A);
    seedOrg(db, ORG_B);
    seedTeam(db, ORG_A, { name: 'A-Active-1' });
    seedTeam(db, ORG_A, { name: 'A-Active-2' });
    seedTeam(db, ORG_A, { name: 'A-Archived', archivedAt: new Date('2026-04-01') });
    seedTeam(db, ORG_B, { name: 'B-Active' });

    const res = await buildApp(db, actor(ORG_A)).request(
      '/api/v1/admin/teams',
      { method: 'GET' },
      STUB_ENV,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { name: string; orgId: string; archivedAt: string | null }[];
    };
    expect(body.success).toBe(true);
    const names = body.data.map((t) => t.name).sort();
    expect(names).toEqual(['A-Active-1', 'A-Active-2']);
    // Every returned row is pinned to the actor's org.
    expect(body.data.every((t) => t.orgId === ORG_A)).toBe(true);
    // Archived rows excluded from the default view.
    expect(body.data.every((t) => t.archivedAt === null)).toBe(true);
  });

  it('returns only archived teams when ?archived=true', async () => {
    const db = freshTeamsDb();
    seedOrg(db, ORG_A);
    seedTeam(db, ORG_A, { name: 'A-Active' });
    seedTeam(db, ORG_A, { name: 'A-Archived', archivedAt: new Date('2026-04-01') });

    const res = await buildApp(db, actor(ORG_A)).request(
      '/api/v1/admin/teams?archived=true',
      { method: 'GET' },
      STUB_ENV,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { name: string; archivedAt: string | null }[];
    };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.name).toBe('A-Archived');
    expect(body.data[0]?.archivedAt).not.toBeNull();
  });
});

describe('POST /api/v1/admin/teams — create', () => {
  it('creates a team with 201 + canonical envelope and writes a row in the actor org', async () => {
    const db = freshTeamsDb();
    seedOrg(db, ORG_A);

    const res = await buildApp(db, actor(ORG_A)).request(
      '/api/v1/admin/teams',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'New Team',
          sport: 'Basketball',
          season: 'Winter 2027',
          ageGroup: 'Varsity',
        }),
      },
      STUB_ENV,
    );

    // Wire shape
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      success: boolean;
      data: {
        id: string;
        orgId: string;
        name: string;
        sport: string;
        season: string;
        ageGroup: string;
        archivedAt: string | null;
      };
    };
    expect(body.success).toBe(true);
    expect(body.data.orgId).toBe(ORG_A);
    expect(body.data.name).toBe('New Team');
    expect(body.data.sport).toBe('Basketball');
    expect(body.data.season).toBe('Winter 2027');
    expect(body.data.ageGroup).toBe('Varsity');
    expect(body.data.archivedAt).toBeNull();

    // DB side-effect
    const reloaded = await db.query.teams.findFirst({
      where: eq(teams.id, body.data.id),
    });
    expect(reloaded).toBeDefined();
    expect(reloaded?.orgId).toBe(ORG_A);
    expect(reloaded?.name).toBe('New Team');
    expect(reloaded?.sport).toBe('Basketball');
  });

  it('returns 400 INVALID_BODY when a required field is missing', async () => {
    const db = freshTeamsDb();
    seedOrg(db, ORG_A);

    const res = await buildApp(db, actor(ORG_A)).request(
      '/api/v1/admin/teams',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Missing fields' }),
      },
      STUB_ENV,
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      success: false,
      error: { code: 'INVALID_BODY' },
    });
  });

  it('returns 400 INVALID_BODY when an unknown extra key is present', async () => {
    const db = freshTeamsDb();
    seedOrg(db, ORG_A);

    const res = await buildApp(db, actor(ORG_A)).request(
      '/api/v1/admin/teams',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'New',
          sport: 'X',
          season: 'Y',
          ageGroup: 'Z',
          orgId: 'org_attack',
        }),
      },
      STUB_ENV,
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      success: false,
      error: { code: 'INVALID_BODY' },
    });
  });
});

describe('PATCH /api/v1/admin/teams/:id — update', () => {
  it('updates the team and a subsequent GET returns the new values', async () => {
    const db = freshTeamsDb();
    seedOrg(db, ORG_A);
    const teamId = seedTeam(db, ORG_A, { name: 'Old', sport: 'Soccer' });

    const app = buildApp(db, actor(ORG_A));
    const patchRes = await app.request(
      `/api/v1/admin/teams/${teamId}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'New Name', sport: 'Tennis' }),
      },
      STUB_ENV,
    );

    expect(patchRes.status).toBe(200);
    const patchBody = (await patchRes.json()) as {
      success: boolean;
      data: { name: string; sport: string };
    };
    expect(patchBody.data.name).toBe('New Name');
    expect(patchBody.data.sport).toBe('Tennis');

    // Read-after-write
    const getRes = await app.request(`/api/v1/admin/teams/${teamId}`, { method: 'GET' }, STUB_ENV);
    const getBody = (await getRes.json()) as { data: { name: string; sport: string } };
    expect(getBody.data.name).toBe('New Name');
    expect(getBody.data.sport).toBe('Tennis');
  });

  it('returns 400 INVALID_BODY when the patch is empty', async () => {
    const db = freshTeamsDb();
    seedOrg(db, ORG_A);
    const teamId = seedTeam(db, ORG_A);

    const res = await buildApp(db, actor(ORG_A)).request(
      `/api/v1/admin/teams/${teamId}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      },
      STUB_ENV,
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      success: false,
      error: { code: 'INVALID_BODY' },
    });
  });
});

describe('POST /api/v1/admin/teams/:id/archive + /restore', () => {
  it('archive stamps archived_at and a default list excludes the team', async () => {
    const db = freshTeamsDb();
    seedOrg(db, ORG_A);
    const teamId = seedTeam(db, ORG_A, { name: 'To Archive' });

    const app = buildApp(db, actor(ORG_A));
    const archiveRes = await app.request(
      `/api/v1/admin/teams/${teamId}/archive`,
      { method: 'POST' },
      STUB_ENV,
    );

    expect(archiveRes.status).toBe(200);
    const archiveBody = (await archiveRes.json()) as {
      data: { archivedAt: string | null };
    };
    expect(archiveBody.data.archivedAt).not.toBeNull();

    // DB side-effect
    const reloaded = await db.query.teams.findFirst({ where: eq(teams.id, teamId) });
    expect(reloaded?.archivedAt).toBeInstanceOf(Date);

    // Default list excludes the archived team.
    const listRes = await app.request('/api/v1/admin/teams', { method: 'GET' }, STUB_ENV);
    const listBody = (await listRes.json()) as { data: { id: string }[] };
    expect(listBody.data.some((t) => t.id === teamId)).toBe(false);
  });

  it('restore clears archived_at', async () => {
    const db = freshTeamsDb();
    seedOrg(db, ORG_A);
    const teamId = seedTeam(db, ORG_A, { archivedAt: new Date('2026-04-01') });

    const res = await buildApp(db, actor(ORG_A)).request(
      `/api/v1/admin/teams/${teamId}/restore`,
      { method: 'POST' },
      STUB_ENV,
    );

    expect(res.status).toBe(200);
    const reloaded = await db.query.teams.findFirst({ where: eq(teams.id, teamId) });
    expect(reloaded?.archivedAt).toBeNull();
  });
});

describe('cross-org isolation', () => {
  it('GET 404 when org A admin reads org B team', async () => {
    const db = freshTeamsDb();
    seedOrg(db, ORG_A);
    seedOrg(db, ORG_B);
    const teamB = seedTeam(db, ORG_B, { name: 'Org-B Team' });

    const res = await buildApp(db, actor(ORG_A)).request(
      `/api/v1/admin/teams/${teamB}`,
      { method: 'GET' },
      STUB_ENV,
    );

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({
      success: false,
      error: { code: 'NOT_FOUND' },
    });
  });

  it('PATCH 404 when org A admin edits org B team and DB row is unchanged', async () => {
    const db = freshTeamsDb();
    seedOrg(db, ORG_A);
    seedOrg(db, ORG_B);
    const teamB = seedTeam(db, ORG_B, { name: 'Org-B Team' });

    const res = await buildApp(db, actor(ORG_A)).request(
      `/api/v1/admin/teams/${teamB}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'HIJACKED' }),
      },
      STUB_ENV,
    );

    expect(res.status).toBe(404);

    // DB row unchanged.
    const reloaded = await db.query.teams.findFirst({
      where: and(eq(teams.id, teamB), eq(teams.orgId, ORG_B)),
    });
    expect(reloaded?.name).toBe('Org-B Team');
  });

  it('archive 404 when org A admin archives org B team', async () => {
    const db = freshTeamsDb();
    seedOrg(db, ORG_A);
    seedOrg(db, ORG_B);
    const teamB = seedTeam(db, ORG_B);

    const res = await buildApp(db, actor(ORG_A)).request(
      `/api/v1/admin/teams/${teamB}/archive`,
      { method: 'POST' },
      STUB_ENV,
    );

    expect(res.status).toBe(404);

    const reloaded = await db.query.teams.findFirst({ where: eq(teams.id, teamB) });
    expect(reloaded?.archivedAt).toBeNull();
  });

  it('restore 404 when org A admin restores org B team', async () => {
    const db = freshTeamsDb();
    seedOrg(db, ORG_A);
    seedOrg(db, ORG_B);
    const teamB = seedTeam(db, ORG_B, { archivedAt: new Date('2026-04-01') });

    const res = await buildApp(db, actor(ORG_A)).request(
      `/api/v1/admin/teams/${teamB}/restore`,
      { method: 'POST' },
      STUB_ENV,
    );

    expect(res.status).toBe(404);
    const reloaded = await db.query.teams.findFirst({ where: eq(teams.id, teamB) });
    expect(reloaded?.archivedAt).toBeInstanceOf(Date);
  });

  it('GET / list returns only the actor-org teams, never the other-org rows', async () => {
    const db = freshTeamsDb();
    seedOrg(db, ORG_A);
    seedOrg(db, ORG_B);
    seedTeam(db, ORG_A, { name: 'A1' });
    seedTeam(db, ORG_A, { name: 'A2' });
    seedTeam(db, ORG_B, { name: 'B1' });
    seedTeam(db, ORG_B, { name: 'B2' });

    const res = await buildApp(db, actor(ORG_A)).request(
      '/api/v1/admin/teams',
      { method: 'GET' },
      STUB_ENV,
    );

    const body = (await res.json()) as { data: { name: string; orgId: string }[] };
    expect(body.data).toHaveLength(2);
    expect(body.data.every((t) => t.orgId === ORG_A)).toBe(true);
  });
});

describe('NOT_FOUND for unknown id in same org', () => {
  it('GET 404 for an unknown team id in the actor org', async () => {
    const db = freshTeamsDb();
    seedOrg(db, ORG_A);

    const res = await buildApp(db, actor(ORG_A)).request(
      '/api/v1/admin/teams/t_does_not_exist',
      { method: 'GET' },
      STUB_ENV,
    );

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({
      success: false,
      error: { code: 'NOT_FOUND' },
    });
  });
});
