// apps/api/src/routes/v1/coach/roster.contract.test.ts
//
// Contract test for `GET /api/v1/coach/teams/:teamId/roster` and
// `GET /api/v1/coach/teams/:teamId/roster/entries/:entryId` (Epic #11
// / Story #912 / Task #919, Task #922).
//
// Pins the wire shape AND the authorization invariants the Tech Spec
// nominates as load-bearing:
//
//   - 200 happy path with seeded roster (Task #919 AC).
//   - 404 for coach-on-other-team-same-org (Task #919 AC).
//   - 404 for coach-on-other-org-team (Task #919 AC).
//   - 401 for signed-out user (Task #919 AC — exercised via the real
//     `app` from `./index.ts` which mounts `clerkAuth` first).
//   - Team-scoped athlete profile: an athlete on two teams returns
//     jersey + position for the URL-bound team only (Task #922 AC).
//
// Two compositions in use:
//
//   1. Anonymous 401 — the real `app` from `apps/api/src/index.ts`. No
//      DB needed: `clerkAuth` refuses before any `c.var.db` access.
//   2. Authorized paths — `createTestApp(db, { actor })` substitutes
//      the Clerk seam only. Every other middleware (the `requireCoachOnTeam`
//      predicate, the per-row org scope inside the query layer) is the
//      real production module.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  coachAssignments,
  organizations,
  rosterEntries,
  teams,
  users,
} from '@repo/shared/db/schema';
import { type AuthContext, createTestApp } from '@repo/shared/testing';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../../index';
import type { RequireInternalUserEnv } from '../../../middleware/auth';
import { coachRosterRoute } from './roster';

const MIGRATIONS_DIR = join(__dirname, '../../../../../../packages/shared/src/db/migrations');

function freshCoachDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  for (const file of [
    '0000_auth_and_rbac.sql',
    '0001_onboarding_schema.sql',
    '0002_org_team_graph.sql',
    '0003_invitations.sql',
    '0004_org_branding.sql',
    '0005_team_metadata.sql',
    '0006_csv_import_batches.sql',
    '0007_roster.sql',
    // Story #1054 / F33 — nullable first_name/last_name on users.
    '0010_users_name.sql',
  ]) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    for (const stmt of sql.split('--> statement-breakpoint').map((s) => s.trim())) {
      if (stmt.length > 0) sqlite.exec(stmt);
    }
  }
  return drizzle(sqlite, {
    schema: { organizations, teams, users, coachAssignments, rosterEntries },
  });
}

type CoachDb = ReturnType<typeof freshCoachDb>;

const ORG_A = 'org_a_test';
const ORG_B = 'org_b_test';

function actor(orgId: string, overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: `u_coach_${orgId}`,
    clerkSubjectId: `user_test_${orgId}`,
    email: `coach-${orgId}@test.invalid`,
    role: 'member',
    orgId,
    teamId: null,
    ...overrides,
  };
}

function seedOrg(db: CoachDb, id: string): void {
  db.insert(organizations)
    .values({ id, name: `Org ${id}`, organizationType: 'CLUB' })
    .onConflictDoNothing()
    .run();
}

function seedTeam(db: CoachDb, orgId: string, id: string): string {
  db.insert(teams)
    .values({
      id,
      orgId,
      name: `Team ${id}`,
      sport: 'Volleyball',
      season: 'Fall 2026',
      ageGroup: 'U14',
    })
    .run();
  return id;
}

function seedUser(
  db: CoachDb,
  orgId: string,
  id: string,
  email?: string,
  name?: { firstName?: string | null; lastName?: string | null },
): string {
  db.insert(users)
    .values({
      id,
      clerkSubjectId: `clerk_${id}`,
      email: email ?? `${id}@test.invalid`,
      firstName: name?.firstName ?? null,
      lastName: name?.lastName ?? null,
      role: 'member',
      orgId,
      teamId: null,
    })
    .run();
  return id;
}

function seedCoachAssignment(
  db: CoachDb,
  orgId: string,
  teamId: string,
  coachUserId: string,
  opts: { id?: string; endedAt?: Date | null } = {},
): string {
  const id = opts.id ?? `ca_${orgId}_${teamId}_${coachUserId}`;
  db.insert(coachAssignments)
    .values({
      id,
      orgId,
      teamId,
      coachUserId,
      endedAt: opts.endedAt ?? null,
    })
    .run();
  return id;
}

function seedRosterEntry(
  db: CoachDb,
  orgId: string,
  teamId: string,
  athleteUserId: string,
  opts: { id?: string; jerseyNumber?: string | null; primaryPosition?: string | null } = {},
): string {
  const id = opts.id ?? `re_${orgId}_${teamId}_${athleteUserId}`;
  db.insert(rosterEntries)
    .values({
      id,
      orgId,
      teamId,
      athleteUserId,
      jerseyNumber: opts.jerseyNumber ?? '7',
      primaryPosition: opts.primaryPosition ?? 'Setter',
    })
    .run();
  return id;
}

function buildApp(db: CoachDb, a: AuthContext) {
  const harness = createTestApp(db, { actor: a }) as unknown as Hono<RequireInternalUserEnv>;
  harness.route('/api/v1/coach/teams/:teamId/roster', coachRosterRoute);
  return harness;
}

const STUB_ENV = { ANALYTICS: { writeDataPoint: () => undefined } };

interface RosterListBody {
  success: boolean;
  data: {
    items: Array<{
      id: string;
      teamId: string;
      athleteUserId: string;
      athleteEmail: string;
      athleteFullName: string;
      jerseyNumber: string | null;
      primaryPosition: string | null;
    }>;
  };
}

interface RosterEntryBody {
  success: boolean;
  data: {
    id: string;
    teamId: string;
    athleteUserId: string;
    jerseyNumber: string | null;
    primaryPosition: string | null;
  };
}

beforeEach(() => {
  // No-op — each test builds its own DB instance via `freshCoachDb()`.
});

describe('GET /api/v1/coach/teams/:teamId/roster — happy path', () => {
  it('returns the team roster with the canonical envelope', async () => {
    // Arrange
    const db = freshCoachDb();
    seedOrg(db, ORG_A);
    const team = seedTeam(db, ORG_A, 't_one');
    const coach = actor(ORG_A);
    seedUser(db, ORG_A, coach.userId, coach.email);
    seedCoachAssignment(db, ORG_A, team, coach.userId);
    const athlete = seedUser(db, ORG_A, 'u_ada', 'ada.lovelace@test.invalid');
    seedRosterEntry(db, ORG_A, team, athlete, {
      id: 're_ada',
      jerseyNumber: '7',
      primaryPosition: 'Setter',
    });

    // Act
    const res = await buildApp(db, coach).request(
      `/api/v1/coach/teams/${team}/roster`,
      { method: 'GET' },
      STUB_ENV,
    );

    // Assert — wire shape
    expect(res.status).toBe(200);
    const body = (await res.json()) as RosterListBody;
    expect(body.success).toBe(true);
    expect(body.data.items).toHaveLength(1);
    const item = body.data.items[0];
    expect(item).toMatchObject({
      id: 're_ada',
      teamId: team,
      athleteUserId: athlete,
      athleteEmail: 'ada.lovelace@test.invalid',
      athleteFullName: 'Ada Lovelace',
      jerseyNumber: '7',
      primaryPosition: 'Setter',
    });
  });
});

describe('GET /api/v1/coach/teams/:teamId/roster — display name (Story #1054)', () => {
  it('renders the Clerk-promoted first/last name when present', async () => {
    // Arrange — athlete has a real Clerk name promoted into users.
    const db = freshCoachDb();
    seedOrg(db, ORG_A);
    const team = seedTeam(db, ORG_A, 't_name');
    const coach = actor(ORG_A);
    seedUser(db, ORG_A, coach.userId, coach.email);
    seedCoachAssignment(db, ORG_A, team, coach.userId);
    const athlete = seedUser(db, ORG_A, 'u_named', 'e2e-roster-s4-001@test.invalid', {
      firstName: 'Grace',
      lastName: 'Hopper',
    });
    seedRosterEntry(db, ORG_A, team, athlete, { id: 're_named' });

    // Act
    const res = await buildApp(db, coach).request(
      `/api/v1/coach/teams/${team}/roster`,
      { method: 'GET' },
      STUB_ENV,
    );

    // Assert — the real name wins over the email-derived fallback.
    expect(res.status).toBe(200);
    const body = (await res.json()) as RosterListBody;
    expect(body.data.items[0]?.athleteFullName).toBe('Grace Hopper');
  });

  it('falls back to the email-derived name when both name columns are null', async () => {
    // Arrange — athlete with no Clerk name (both columns null).
    const db = freshCoachDb();
    seedOrg(db, ORG_A);
    const team = seedTeam(db, ORG_A, 't_fallback');
    const coach = actor(ORG_A);
    seedUser(db, ORG_A, coach.userId, coach.email);
    seedCoachAssignment(db, ORG_A, team, coach.userId);
    const athlete = seedUser(db, ORG_A, 'u_noname', 'e2e-roster-s4-001@test.invalid');
    seedRosterEntry(db, ORG_A, team, athlete, { id: 're_fallback' });

    // Act
    const res = await buildApp(db, coach).request(
      `/api/v1/coach/teams/${team}/roster`,
      { method: 'GET' },
      STUB_ENV,
    );

    // Assert — the email local-part is title-cased into the fallback.
    expect(res.status).toBe(200);
    const body = (await res.json()) as RosterListBody;
    expect(body.data.items[0]?.athleteFullName).toBe('E2e Roster S4 001');
  });
});

describe('GET /api/v1/coach/teams/:teamId/roster — authorization', () => {
  it('returns 404 when the coach is assigned to a different team in the same org', async () => {
    const db = freshCoachDb();
    seedOrg(db, ORG_A);
    const teamMine = seedTeam(db, ORG_A, 't_mine');
    const teamOther = seedTeam(db, ORG_A, 't_other');
    const coach = actor(ORG_A);
    seedUser(db, ORG_A, coach.userId, coach.email);
    // Coach is assigned to teamMine — NOT teamOther.
    seedCoachAssignment(db, ORG_A, teamMine, coach.userId);

    const res = await buildApp(db, coach).request(
      `/api/v1/coach/teams/${teamOther}/roster`,
      { method: 'GET' },
      STUB_ENV,
    );

    expect(res.status).toBe(404);
    const body = (await res.json()) as {
      success: boolean;
      error: { code: string; message: string };
    };
    expect(body).toMatchObject({
      success: false,
      error: { code: 'NOT_FOUND', message: 'team-not-found' },
    });
  });

  it('returns 404 when the coach is on a team in a different org', async () => {
    const db = freshCoachDb();
    seedOrg(db, ORG_A);
    seedOrg(db, ORG_B);
    const teamA = seedTeam(db, ORG_A, 't_a');
    const teamB = seedTeam(db, ORG_B, 't_b');
    const coachA = actor(ORG_A);
    seedUser(db, ORG_A, coachA.userId, coachA.email);
    // The coach is genuinely assigned in org A's team A, but asks for
    // org B's team B. The `requireCoachOnTeam` predicate refuses
    // because there is no `coach_assignments` row for (coachA.userId,
    // teamB).
    seedCoachAssignment(db, ORG_A, teamA, coachA.userId);
    // Seed an unrelated athlete on team B so the row is not silently
    // empty (defense-in-depth check: the route must refuse based on
    // the predicate, not because the underlying table is empty).
    const bAthlete = seedUser(db, ORG_B, 'u_b_ath');
    seedRosterEntry(db, ORG_B, teamB, bAthlete, { id: 're_b' });

    const res = await buildApp(db, coachA).request(
      `/api/v1/coach/teams/${teamB}/roster`,
      { method: 'GET' },
      STUB_ENV,
    );

    expect(res.status).toBe(404);
    const body = (await res.json()) as {
      success: boolean;
      error: { code: string };
    };
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('returns 401 UNAUTHENTICATED for an anonymous request', async () => {
    // No cookie, no Authorization header — `clerkAuth` (mounted on
    // `*` in the real app) returns 401 before any DB access.
    const res = await app.request(
      '/api/v1/coach/teams/anything/roster',
      { method: 'GET' },
      STUB_ENV,
    );

    expect(res.status).toBe(401);
    const body = (await res.json()) as {
      success: boolean;
      error: { code: string };
    };
    expect(body).toMatchObject({
      success: false,
      error: { code: 'UNAUTHENTICATED' },
    });
  });
});

describe('GET /api/v1/coach/teams/:teamId/roster/entries/:entryId — team-scoped athlete profile', () => {
  it('returns the roster entry whose teamId matches the URL', async () => {
    // Arrange — one athlete on two teams in org A, both teams coached
    // by the same coach. Each roster row carries a different jersey;
    // the team-scoped profile must surface only the URL-bound team's
    // jersey.
    const db = freshCoachDb();
    seedOrg(db, ORG_A);
    const teamV = seedTeam(db, ORG_A, 't_v');
    const teamB = seedTeam(db, ORG_A, 't_b');
    const coach = actor(ORG_A);
    seedUser(db, ORG_A, coach.userId, coach.email);
    seedCoachAssignment(db, ORG_A, teamV, coach.userId, { id: 'ca_v' });
    seedCoachAssignment(db, ORG_A, teamB, coach.userId, { id: 'ca_b' });
    const athlete = seedUser(db, ORG_A, 'u_dual');
    const entryV = seedRosterEntry(db, ORG_A, teamV, athlete, {
      id: 're_v',
      jerseyNumber: '07',
      primaryPosition: 'Setter',
    });
    seedRosterEntry(db, ORG_A, teamB, athlete, {
      id: 're_b',
      jerseyNumber: '23',
      primaryPosition: 'Guard',
    });

    // Act — ask for the volleyball team's entry
    const harness = buildApp(db, coach);
    const res = await harness.request(
      `/api/v1/coach/teams/${teamV}/roster/entries/${entryV}`,
      { method: 'GET' },
      STUB_ENV,
    );

    // Assert
    expect(res.status).toBe(200);
    const body = (await res.json()) as RosterEntryBody;
    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({
      id: entryV,
      teamId: teamV,
      jerseyNumber: '07',
      primaryPosition: 'Setter',
    });
  });

  it('returns 404 when the entry id belongs to a different team', async () => {
    const db = freshCoachDb();
    seedOrg(db, ORG_A);
    const teamV = seedTeam(db, ORG_A, 't_v');
    const teamB = seedTeam(db, ORG_A, 't_b');
    const coach = actor(ORG_A);
    seedUser(db, ORG_A, coach.userId, coach.email);
    seedCoachAssignment(db, ORG_A, teamV, coach.userId, { id: 'ca_v' });
    seedCoachAssignment(db, ORG_A, teamB, coach.userId, { id: 'ca_b' });
    const athlete = seedUser(db, ORG_A, 'u_x');
    const entryV = seedRosterEntry(db, ORG_A, teamV, athlete, { id: 're_v' });

    // The entry exists, but we ask for it scoped to teamB.
    const res = await buildApp(db, coach).request(
      `/api/v1/coach/teams/${teamB}/roster/entries/${entryV}`,
      { method: 'GET' },
      STUB_ENV,
    );

    expect(res.status).toBe(404);
  });
});
