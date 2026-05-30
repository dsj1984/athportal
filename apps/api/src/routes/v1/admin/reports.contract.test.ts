// apps/api/src/routes/v1/admin/reports.contract.test.ts
//
// Contract test for `GET /api/v1/admin/reports/verified-achievements`
// (Epic #10 / Story #679 / Task #698).
//
// Pins the wire shape AND the cross-tenant isolation invariants for the
// verified-achievement aggregation report:
//
//   - Happy path                returns 200 + canonical envelope with
//                               `{ byTeam, bySport }` arrays sorted
//                               alphabetically by their label.
//   - Active memberships only   a row with `endedAt` stamped does not
//                               keep its team / sport alive in the
//                               aggregation when no active membership
//                               remains.
//   - Pinned-zero count         the upstream `verified_achievements`
//                               table does not exist on epic/10 yet —
//                               Story #661's roster pinned
//                               `verifiedAchievementCount: 0` for the
//                               same reason. The report follows the
//                               same pattern; this test asserts every
//                               row's count is exactly 0 so the v1.0
//                               achievements Epic can flip the source
//                               and watch this test fail loudly.
//   - Empty org                 returns `{ byTeam: [], bySport: [] }`.
//   - Cross-org isolation       an org_admin from org A sees only their
//                               own org's teams/sports — never a row
//                               from org B.
//   - 400 MISSING_ORG_SCOPE     a dev_admin with no org binding and no
//                               `?orgId=` escape returns the canonical
//                               error envelope.
//
// Composition: real `reportsAdminRoute` mounted at
// `/api/v1/admin/reports` against the test-auth seam
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
import { reportsAdminRoute } from './reports';

const MIGRATIONS_DIR = join(__dirname, '../../../../../../packages/shared/src/db/migrations');

function freshReportDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  for (const file of [
    '0000_auth_and_rbac.sql',
    '0001_onboarding_schema.sql',
    '0002_org_team_graph.sql',
    '0003_invitations.sql',
    '0004_org_branding.sql',
    '0005_team_metadata.sql',
    // Story #1054 / F33 — nullable first_name/last_name on users.
    '0010_users_name.sql',
  ]) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    for (const stmt of sql.split('--> statement-breakpoint').map((s) => s.trim())) {
      if (stmt.length > 0) sqlite.exec(stmt);
    }
  }
  return drizzle(sqlite, { schema: { organizations, teams, users, athleteMemberships } });
}

type ReportDb = ReturnType<typeof freshReportDb>;

const ORG_A = 'org_a_report';
const ORG_B = 'org_b_report';

function actor(orgId: string | null, overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: `u_admin_${orgId ?? 'none'}`,
    clerkSubjectId: `user_test_${orgId ?? 'none'}`,
    email: `admin-${orgId ?? 'none'}@test.invalid`,
    role: 'org_admin',
    orgId,
    teamId: null,
    ...overrides,
  };
}

function seedOrg(db: ReportDb, id: string): void {
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

function seedTeam(db: ReportDb, orgId: string, opts: SeedTeamOpts = {}): string {
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

function seedAthleteUser(db: ReportDb, orgId: string, id: string, email: string): string {
  db.insert(users)
    .values({
      id,
      clerkSubjectId: `clerk_${id}`,
      email,
      role: 'member',
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
  db: ReportDb,
  orgId: string,
  teamId: string,
  athleteUserId: string,
  opts: SeedMembershipOpts = {},
): string {
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

function buildApp(db: ReportDb, a: AuthContext) {
  const harness = createTestApp(db, { actor: a }) as unknown as Hono<RequireInternalUserEnv>;
  harness.route('/api/v1/admin/reports', reportsAdminRoute);
  return harness;
}

const STUB_ENV = { ANALYTICS: { writeDataPoint: () => undefined } };

interface ByTeamBody {
  teamId: string;
  teamName: string;
  verifiedAchievementCount: number;
}
interface BySportBody {
  sport: string;
  verifiedAchievementCount: number;
}
interface ReportBody {
  success: boolean;
  data: { byTeam: ByTeamBody[]; bySport: BySportBody[] };
}

beforeEach(() => {
  // No-op — each test builds its own DB instance via `freshReportDb()`.
});

describe('GET /api/v1/admin/reports/verified-achievements — happy path', () => {
  it('returns by-team and by-sport aggregations scoped to the actor org', async () => {
    // Arrange — two teams, two sports, three athletes in org A.
    const db = freshReportDb();
    seedOrg(db, ORG_A);
    const tSpikers = seedTeam(db, ORG_A, {
      id: 't_spikers',
      name: 'Spikers',
      sport: 'Volleyball',
    });
    const tDunkers = seedTeam(db, ORG_A, {
      id: 't_dunkers',
      name: 'Dunkers',
      sport: 'Basketball',
    });
    seedAthleteUser(db, ORG_A, 'u_a1', 'a1@test.invalid');
    seedAthleteUser(db, ORG_A, 'u_a2', 'a2@test.invalid');
    seedAthleteUser(db, ORG_A, 'u_a3', 'a3@test.invalid');
    seedMembership(db, ORG_A, tSpikers, 'u_a1', { id: 'am_s1' });
    seedMembership(db, ORG_A, tSpikers, 'u_a2', { id: 'am_s2' });
    seedMembership(db, ORG_A, tDunkers, 'u_a3', { id: 'am_d1' });

    // Act
    const res = await buildApp(db, actor(ORG_A)).request(
      '/api/v1/admin/reports/verified-achievements',
      { method: 'GET' },
      STUB_ENV,
    );

    // Assert — wire shape
    expect(res.status).toBe(200);
    const body = (await res.json()) as ReportBody;
    expect(body.success).toBe(true);

    // Each team surfaces exactly once, sorted alphabetically by name.
    expect(body.data.byTeam).toEqual([
      { teamId: 't_dunkers', teamName: 'Dunkers', verifiedAchievementCount: 0 },
      { teamId: 't_spikers', teamName: 'Spikers', verifiedAchievementCount: 0 },
    ]);

    // Each distinct sport surfaces exactly once, sorted alphabetically.
    expect(body.data.bySport).toEqual([
      { sport: 'Basketball', verifiedAchievementCount: 0 },
      { sport: 'Volleyball', verifiedAchievementCount: 0 },
    ]);
  });

  it('pins verifiedAchievementCount to 0 on every row (no achievements table yet on epic/10)', async () => {
    // Pinning this assertion is load-bearing: when the v1.0
    // achievements Epic lands the real table, this test will fail
    // loudly and tell the implementer to refactor the count source in
    // `./reports.ts` alongside the schema bump. Story #661 took the
    // same approach on the roster surface.
    const db = freshReportDb();
    seedOrg(db, ORG_A);
    const t = seedTeam(db, ORG_A, { id: 't_only', name: 'Only', sport: 'Soccer' });
    seedAthleteUser(db, ORG_A, 'u_x', 'x@test.invalid');
    seedMembership(db, ORG_A, t, 'u_x', { id: 'am_x' });

    const res = await buildApp(db, actor(ORG_A)).request(
      '/api/v1/admin/reports/verified-achievements',
      { method: 'GET' },
      STUB_ENV,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as ReportBody;
    for (const row of body.data.byTeam) {
      expect(row.verifiedAchievementCount).toBe(0);
    }
    for (const row of body.data.bySport) {
      expect(row.verifiedAchievementCount).toBe(0);
    }
  });

  it('excludes teams whose only memberships are end-dated', async () => {
    const db = freshReportDb();
    seedOrg(db, ORG_A);
    const tActive = seedTeam(db, ORG_A, {
      id: 't_active',
      name: 'Active',
      sport: 'Volleyball',
    });
    const tRetired = seedTeam(db, ORG_A, {
      id: 't_retired',
      name: 'Retired',
      sport: 'Tennis',
    });
    seedAthleteUser(db, ORG_A, 'u_act', 'act@test.invalid');
    seedAthleteUser(db, ORG_A, 'u_ret', 'ret@test.invalid');
    seedMembership(db, ORG_A, tActive, 'u_act', { id: 'am_act' });
    seedMembership(db, ORG_A, tRetired, 'u_ret', {
      id: 'am_ret',
      endedAt: new Date('2026-01-01'),
    });

    const res = await buildApp(db, actor(ORG_A)).request(
      '/api/v1/admin/reports/verified-achievements',
      { method: 'GET' },
      STUB_ENV,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as ReportBody;
    expect(body.data.byTeam.map((r) => r.teamId)).toEqual(['t_active']);
    expect(body.data.bySport.map((r) => r.sport)).toEqual(['Volleyball']);
  });

  it('returns empty arrays for an org with no active memberships', async () => {
    const db = freshReportDb();
    seedOrg(db, ORG_A);

    const res = await buildApp(db, actor(ORG_A)).request(
      '/api/v1/admin/reports/verified-achievements',
      { method: 'GET' },
      STUB_ENV,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as ReportBody;
    expect(body).toEqual({ success: true, data: { byTeam: [], bySport: [] } });
  });
});

describe('GET /api/v1/admin/reports/verified-achievements — cross-org isolation', () => {
  it('an org_admin from org A cannot read org B teams or sports', async () => {
    const db = freshReportDb();
    seedOrg(db, ORG_A);
    seedOrg(db, ORG_B);
    const teamA = seedTeam(db, ORG_A, { id: 't_a', name: 'A-Only', sport: 'Volleyball' });
    const teamB = seedTeam(db, ORG_B, { id: 't_b', name: 'B-Only', sport: 'Basketball' });
    seedAthleteUser(db, ORG_A, 'u_a', 'a@test.invalid');
    seedAthleteUser(db, ORG_B, 'u_b', 'b@test.invalid');
    seedMembership(db, ORG_A, teamA, 'u_a', { id: 'am_a' });
    seedMembership(db, ORG_B, teamB, 'u_b', { id: 'am_b' });

    const res = await buildApp(db, actor(ORG_A)).request(
      '/api/v1/admin/reports/verified-achievements',
      { method: 'GET' },
      STUB_ENV,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as ReportBody;
    const teamIds = body.data.byTeam.map((r) => r.teamId);
    const sports = body.data.bySport.map((r) => r.sport);
    expect(teamIds).toEqual(['t_a']);
    expect(sports).toEqual(['Volleyball']);
    // Defense in depth — no org B id or sport leaks through, ever.
    expect(teamIds).not.toContain('t_b');
    expect(sports).not.toContain('Basketball');
  });
});

describe('GET /api/v1/admin/reports/verified-achievements — missing org scope', () => {
  it('returns 400 MISSING_ORG_SCOPE for a dev_admin without orgId or ?orgId=', async () => {
    const db = freshReportDb();

    const res = await buildApp(
      db,
      actor(null, { userId: 'u_devadmin', role: 'dev_admin', orgId: null }),
    ).request('/api/v1/admin/reports/verified-achievements', { method: 'GET' }, STUB_ENV);

    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      success: boolean;
      error: { code: string; message: string };
    };
    expect(body).toMatchObject({
      success: false,
      error: { code: 'MISSING_ORG_SCOPE' },
    });
  });
});
