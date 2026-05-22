// apps/api/src/routes/v1/admin/roster.contract.test.ts
//
// Contract test for `GET /api/v1/admin/roster` (Epic #10 / Story #661 /
// Task #692).
//
// Pins the wire shape AND the cross-tenant isolation invariants for the
// org-wide roster read endpoint:
//
//   - GET /                         happy path returns 200 + canonical
//                                   envelope with items projected from
//                                   the athleteMemberships ⋈ users ⋈
//                                   teams join, scoped to the actor's
//                                   org.
//   - ?teamId=                      narrows to one team.
//   - ?sport=                       narrows by teams.sport.
//   - Pagination                    fetching one page returns a stable
//                                   nextCursor; the next page picks up
//                                   exactly where the previous ended;
//                                   the final page has nextCursor: null.
//   - Cross-org isolation           an org_admin from org A cannot read
//                                   org B's roster — at most their own
//                                   org's rows appear in the response,
//                                   never a row from the other org.
//   - Active memberships only       a row with `endedAt` stamped is
//                                   excluded from the list.
//   - INVALID_QUERY                 unknown query keys are rejected
//                                   (the schema is `.strict()`).
//
// Composition: real `rosterAdminRoute` mounted at
// `/api/v1/admin/roster` against the test-auth seam
// (`createTestApp(db, { actor })`). The `requireRole('org_admin')` gate
// from `./index.ts` is NOT in the chain here — its behavior is
// exhaustively covered by `./admin-router.contract.test.ts` and
// `./mount.contract.test.ts`. Mounting the bare route lets this test
// focus on the handler-level invariants without re-asserting the gate.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { athleteMemberships, organizations, teams, users } from '@repo/shared/db/schema';
import { type AuthContext, createTestApp } from '@repo/shared/testing';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';
import type { RequireInternalUserEnv } from '../../../middleware/auth';
import { rosterAdminRoute } from './roster';

const MIGRATIONS_DIR = join(__dirname, '../../../../../../packages/shared/src/db/migrations');

function freshRosterDb() {
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
  return drizzle(sqlite, { schema: { organizations, teams, users, athleteMemberships } });
}

type RosterDb = ReturnType<typeof freshRosterDb>;

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

function seedOrg(db: RosterDb, id: string): void {
  db.insert(organizations)
    .values({ id, name: `Org ${id}`, organizationType: 'CLUB' })
    .onConflictDoNothing()
    .run();
}

interface SeedTeamOpts {
  id?: string;
  name?: string;
  sport?: string;
  ageGroup?: string;
  season?: string;
}

function seedTeam(db: RosterDb, orgId: string, opts: SeedTeamOpts = {}): string {
  const id = opts.id ?? `t_${orgId}_${Math.random().toString(36).slice(2, 8)}`;
  db.insert(teams)
    .values({
      id,
      orgId,
      name: opts.name ?? 'Default Team',
      sport: opts.sport ?? 'Volleyball',
      season: opts.season ?? 'Fall 2026',
      ageGroup: opts.ageGroup ?? 'U14',
    })
    .run();
  return id;
}

interface SeedUserOpts {
  id?: string;
  email?: string;
  role?: string;
}

function seedAthleteUser(db: RosterDb, orgId: string, opts: SeedUserOpts = {}): string {
  const id = opts.id ?? `u_${orgId}_${Math.random().toString(36).slice(2, 8)}`;
  db.insert(users)
    .values({
      id,
      clerkSubjectId: `clerk_${id}`,
      email: opts.email ?? `${id}@test.invalid`,
      role: opts.role ?? 'member',
      orgId,
      teamId: null,
    })
    .run();
  return id;
}

interface SeedMembershipOpts {
  id?: string;
  endedAt?: Date | null;
}

function seedMembership(
  db: RosterDb,
  orgId: string,
  teamId: string,
  athleteUserId: string,
  opts: SeedMembershipOpts = {},
): string {
  // Cursor pagination orders on the membership PK, so seed callers can
  // pass an explicit `id` to make ordering deterministic per test.
  const id = opts.id ?? `am_${orgId}_${Math.random().toString(36).slice(2, 8)}`;
  db.insert(athleteMemberships)
    .values({
      id,
      orgId,
      teamId,
      athleteUserId,
      endedAt: opts.endedAt ?? null,
    })
    .run();
  return id;
}

function buildApp(db: RosterDb, a: AuthContext) {
  const harness = createTestApp(db, { actor: a }) as unknown as Hono<RequireInternalUserEnv>;
  harness.route('/api/v1/admin/roster', rosterAdminRoute);
  return harness;
}

const STUB_ENV = { ANALYTICS: { writeDataPoint: () => undefined } };

interface RosterItemBody {
  athleteId: string;
  fullName: string;
  teamId: string;
  teamName: string;
  sport: string;
  ageGroup: string;
  verifiedAchievementCount: number;
}

interface RosterPageBody {
  success: boolean;
  data: {
    items: RosterItemBody[];
    nextCursor: string | null;
  };
}

beforeEach(() => {
  // No-op — each test builds its own DB instance via `freshRosterDb()`.
});

describe('GET /api/v1/admin/roster — happy path', () => {
  it('returns athletes scoped to the actor org with the canonical envelope', async () => {
    // Arrange
    const db = freshRosterDb();
    seedOrg(db, ORG_A);
    const teamA = seedTeam(db, ORG_A, { name: 'A-Spikers', sport: 'Volleyball', ageGroup: 'U14' });
    const athlete = seedAthleteUser(db, ORG_A, {
      id: 'u_ada',
      email: 'ada.lovelace@test.invalid',
    });
    seedMembership(db, ORG_A, teamA, athlete, { id: 'am_001' });

    // Act
    const res = await buildApp(db, actor(ORG_A)).request(
      '/api/v1/admin/roster',
      { method: 'GET' },
      STUB_ENV,
    );

    // Assert — wire shape
    expect(res.status).toBe(200);
    const body = (await res.json()) as RosterPageBody;
    expect(body.success).toBe(true);
    expect(body.data.items).toHaveLength(1);
    const item = body.data.items[0] as RosterItemBody;
    expect(item).toMatchObject({
      athleteId: 'u_ada',
      fullName: 'Ada Lovelace',
      teamId: teamA,
      teamName: 'A-Spikers',
      sport: 'Volleyball',
      ageGroup: 'U14',
      verifiedAchievementCount: 0,
    });
    expect(body.data.nextCursor).toBeNull();
  });

  it('excludes end-dated memberships from the active roster', async () => {
    const db = freshRosterDb();
    seedOrg(db, ORG_A);
    const teamA = seedTeam(db, ORG_A);
    const active = seedAthleteUser(db, ORG_A, { id: 'u_active', email: 'active@test.invalid' });
    const ended = seedAthleteUser(db, ORG_A, { id: 'u_ended', email: 'ended@test.invalid' });
    seedMembership(db, ORG_A, teamA, active, { id: 'am_active' });
    seedMembership(db, ORG_A, teamA, ended, {
      id: 'am_ended',
      endedAt: new Date('2026-01-01'),
    });

    const res = await buildApp(db, actor(ORG_A)).request(
      '/api/v1/admin/roster',
      { method: 'GET' },
      STUB_ENV,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as RosterPageBody;
    const ids = body.data.items.map((i) => i.athleteId);
    expect(ids).toEqual(['u_active']);
  });
});

describe('GET /api/v1/admin/roster — filters', () => {
  it('narrows by ?teamId', async () => {
    const db = freshRosterDb();
    seedOrg(db, ORG_A);
    const team1 = seedTeam(db, ORG_A, { id: 't_one', name: 'Team One' });
    const team2 = seedTeam(db, ORG_A, { id: 't_two', name: 'Team Two' });
    const a1 = seedAthleteUser(db, ORG_A, { id: 'u_a1', email: 'a1@test.invalid' });
    const a2 = seedAthleteUser(db, ORG_A, { id: 'u_a2', email: 'a2@test.invalid' });
    seedMembership(db, ORG_A, team1, a1, { id: 'am_t1_a1' });
    seedMembership(db, ORG_A, team2, a2, { id: 'am_t2_a2' });

    const res = await buildApp(db, actor(ORG_A)).request(
      `/api/v1/admin/roster?teamId=${team1}`,
      { method: 'GET' },
      STUB_ENV,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as RosterPageBody;
    const ids = body.data.items.map((i) => i.athleteId);
    expect(ids).toEqual(['u_a1']);
  });

  it('narrows by ?sport', async () => {
    const db = freshRosterDb();
    seedOrg(db, ORG_A);
    const vball = seedTeam(db, ORG_A, { id: 't_vball', sport: 'Volleyball' });
    const bball = seedTeam(db, ORG_A, { id: 't_bball', sport: 'Basketball' });
    const a1 = seedAthleteUser(db, ORG_A, { id: 'u_v1', email: 'v1@test.invalid' });
    const a2 = seedAthleteUser(db, ORG_A, { id: 'u_b1', email: 'b1@test.invalid' });
    seedMembership(db, ORG_A, vball, a1, { id: 'am_v' });
    seedMembership(db, ORG_A, bball, a2, { id: 'am_b' });

    const res = await buildApp(db, actor(ORG_A)).request(
      '/api/v1/admin/roster?sport=Basketball',
      { method: 'GET' },
      STUB_ENV,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as RosterPageBody;
    const ids = body.data.items.map((i) => i.athleteId);
    expect(ids).toEqual(['u_b1']);
  });
});

describe('GET /api/v1/admin/roster — pagination', () => {
  it('issues a stable nextCursor and resumes correctly on the next page', async () => {
    const db = freshRosterDb();
    seedOrg(db, ORG_A);
    const team = seedTeam(db, ORG_A);
    // Seed five athletes so we can request a 2-row page and verify the
    // cursor advances through every row exactly once.
    for (let i = 1; i <= 5; i++) {
      const id = `u_p${i}`;
      seedAthleteUser(db, ORG_A, { id, email: `p${i}@test.invalid` });
      seedMembership(db, ORG_A, team, id, { id: `am_p${i.toString().padStart(2, '0')}` });
    }

    const app = buildApp(db, actor(ORG_A));

    // First page
    const res1 = await app.request('/api/v1/admin/roster?limit=2', { method: 'GET' }, STUB_ENV);
    expect(res1.status).toBe(200);
    const body1 = (await res1.json()) as RosterPageBody;
    expect(body1.data.items.map((i) => i.athleteId)).toEqual(['u_p1', 'u_p2']);
    expect(body1.data.nextCursor).toBe('am_p02');

    // Second page
    const res2 = await app.request(
      `/api/v1/admin/roster?limit=2&cursor=${body1.data.nextCursor}`,
      { method: 'GET' },
      STUB_ENV,
    );
    expect(res2.status).toBe(200);
    const body2 = (await res2.json()) as RosterPageBody;
    expect(body2.data.items.map((i) => i.athleteId)).toEqual(['u_p3', 'u_p4']);
    expect(body2.data.nextCursor).toBe('am_p04');

    // Final page — only one row left, so nextCursor is null.
    const res3 = await app.request(
      `/api/v1/admin/roster?limit=2&cursor=${body2.data.nextCursor}`,
      { method: 'GET' },
      STUB_ENV,
    );
    expect(res3.status).toBe(200);
    const body3 = (await res3.json()) as RosterPageBody;
    expect(body3.data.items.map((i) => i.athleteId)).toEqual(['u_p5']);
    expect(body3.data.nextCursor).toBeNull();
  });
});

describe('GET /api/v1/admin/roster — cross-org isolation', () => {
  it('an org_admin in org A cannot read org B athletes', async () => {
    const db = freshRosterDb();
    seedOrg(db, ORG_A);
    seedOrg(db, ORG_B);
    const teamA = seedTeam(db, ORG_A, { id: 't_a' });
    const teamB = seedTeam(db, ORG_B, { id: 't_b' });
    const aAth = seedAthleteUser(db, ORG_A, { id: 'u_a', email: 'a@test.invalid' });
    const bAth = seedAthleteUser(db, ORG_B, { id: 'u_b', email: 'b@test.invalid' });
    seedMembership(db, ORG_A, teamA, aAth, { id: 'am_a' });
    seedMembership(db, ORG_B, teamB, bAth, { id: 'am_b' });

    const res = await buildApp(db, actor(ORG_A)).request(
      '/api/v1/admin/roster',
      { method: 'GET' },
      STUB_ENV,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as RosterPageBody;
    const ids = body.data.items.map((i) => i.athleteId);
    expect(ids).toEqual(['u_a']);
    // Defense in depth — no org B id leaks through, ever.
    expect(ids).not.toContain('u_b');
  });

  it('an org_admin targeting another org via ?teamId still sees nothing', async () => {
    // The AC names "an org_admin from org A cannot read org B's
    // roster" — even when they construct a request with knowledge of
    // org B's team id, the org-scope predicate on the join eliminates
    // every row.
    const db = freshRosterDb();
    seedOrg(db, ORG_A);
    seedOrg(db, ORG_B);
    const teamB = seedTeam(db, ORG_B, { id: 't_b_target' });
    const bAth = seedAthleteUser(db, ORG_B, { id: 'u_b_target', email: 'b@test.invalid' });
    seedMembership(db, ORG_B, teamB, bAth, { id: 'am_b_target' });

    const res = await buildApp(db, actor(ORG_A)).request(
      `/api/v1/admin/roster?teamId=${teamB}`,
      { method: 'GET' },
      STUB_ENV,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as RosterPageBody;
    expect(body.data.items).toEqual([]);
  });
});

describe('GET /api/v1/admin/roster — query validation', () => {
  it('rejects unknown query keys with INVALID_QUERY', async () => {
    const db = freshRosterDb();
    seedOrg(db, ORG_A);

    const res = await buildApp(db, actor(ORG_A)).request(
      '/api/v1/admin/roster?bogus=1',
      { method: 'GET' },
      STUB_ENV,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      success: boolean;
      error: { code: string; message: string };
    };
    expect(body).toMatchObject({
      success: false,
      error: { code: 'INVALID_QUERY' },
    });
  });
});
