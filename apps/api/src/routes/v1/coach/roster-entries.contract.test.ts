// apps/api/src/routes/v1/coach/roster-entries.contract.test.ts
//
// Contract test for the mutation surface
//   PATCH  /api/v1/coach/teams/:teamId/roster/entries/:entryId
//   DELETE /api/v1/coach/teams/:teamId/roster/entries/:entryId
// (Epic #11 / Story #917 / Task #924).
//
// Pins:
//   - PATCH persists `jerseyNumber` / `primaryPosition` and the
//     response carries the projected entry.
//   - PATCH preserves leading-zero jersey numbers (e.g. "07") through
//     a full round-trip — confirms the `text`-typed column survives.
//   - PATCH surfaces a soft-warning `duplicateJerseyNumber: true` when
//     another active entry on the same team uses the same number.
//   - PATCH refuses an empty body with 400 INVALID_INPUT.
//   - DELETE sets `ended_at` and the entry no longer surfaces in
//     `listRosterEntries`.
//   - DELETE is idempotent: a second DELETE on the same id returns 204.
//   - Cross-team / cross-org coach receives 404 on both endpoints; the
//     row stays untouched (defense-in-depth check).

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
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';
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

function seedUser(db: CoachDb, orgId: string, id: string, email?: string): string {
  db.insert(users)
    .values({
      id,
      clerkSubjectId: `clerk_${id}`,
      email: email ?? `${id}@test.invalid`,
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

interface PatchSuccessBody {
  success: true;
  data: {
    entry: {
      id: string;
      teamId: string;
      jerseyNumber: string | null;
      primaryPosition: string | null;
    };
    warnings?: { duplicateJerseyNumber?: boolean };
  };
}

interface ErrorBody {
  success: false;
  error: { code: string; message: string };
}

beforeEach(() => {
  // No-op — each test builds its own DB instance via `freshCoachDb()`.
});

describe('PATCH /api/v1/coach/teams/:teamId/roster/entries/:entryId', () => {
  it('persists jerseyNumber and primaryPosition and returns the projected entry', async () => {
    // Arrange
    const db = freshCoachDb();
    seedOrg(db, ORG_A);
    const team = seedTeam(db, ORG_A, 't_one');
    const coach = actor(ORG_A);
    seedUser(db, ORG_A, coach.userId, coach.email);
    seedCoachAssignment(db, ORG_A, team, coach.userId);
    const athlete = seedUser(db, ORG_A, 'u_ada', 'ada.lovelace@test.invalid');
    const entryId = seedRosterEntry(db, ORG_A, team, athlete, {
      id: 're_ada',
      jerseyNumber: '7',
      primaryPosition: 'Setter',
    });

    // Act
    const res = await buildApp(db, coach).request(
      `/api/v1/coach/teams/${team}/roster/entries/${entryId}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jerseyNumber: '11', primaryPosition: 'Libero' }),
      },
      STUB_ENV,
    );

    // Assert
    expect(res.status).toBe(200);
    const body = (await res.json()) as PatchSuccessBody;
    expect(body.success).toBe(true);
    expect(body.data.entry).toMatchObject({
      id: entryId,
      teamId: team,
      jerseyNumber: '11',
      primaryPosition: 'Libero',
    });
    expect(body.data.warnings).toBeUndefined();

    // DB assertion: the persisted row matches the response.
    const rows = db.select().from(rosterEntries).where(eq(rosterEntries.id, entryId)).all();
    expect(rows[0]?.jerseyNumber).toBe('11');
    expect(rows[0]?.primaryPosition).toBe('Libero');
  });

  it('preserves a leading-zero jersey number like "07" through the round-trip', async () => {
    const db = freshCoachDb();
    seedOrg(db, ORG_A);
    const team = seedTeam(db, ORG_A, 't_one');
    const coach = actor(ORG_A);
    seedUser(db, ORG_A, coach.userId, coach.email);
    seedCoachAssignment(db, ORG_A, team, coach.userId);
    const athlete = seedUser(db, ORG_A, 'u_ada');
    const entryId = seedRosterEntry(db, ORG_A, team, athlete);

    const res = await buildApp(db, coach).request(
      `/api/v1/coach/teams/${team}/roster/entries/${entryId}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jerseyNumber: '07' }),
      },
      STUB_ENV,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as PatchSuccessBody;
    // Critical: the value MUST be the string "07", not coerced to 7.
    expect(body.data.entry.jerseyNumber).toBe('07');

    const rows = db.select().from(rosterEntries).where(eq(rosterEntries.id, entryId)).all();
    expect(rows[0]?.jerseyNumber).toBe('07');
  });

  it('surfaces a soft-warning duplicateJerseyNumber when another active entry uses the same number', async () => {
    const db = freshCoachDb();
    seedOrg(db, ORG_A);
    const team = seedTeam(db, ORG_A, 't_one');
    const coach = actor(ORG_A);
    seedUser(db, ORG_A, coach.userId, coach.email);
    seedCoachAssignment(db, ORG_A, team, coach.userId);
    const ada = seedUser(db, ORG_A, 'u_ada');
    const bea = seedUser(db, ORG_A, 'u_bea');
    seedRosterEntry(db, ORG_A, team, ada, { id: 're_ada', jerseyNumber: '11' });
    const beaEntry = seedRosterEntry(db, ORG_A, team, bea, {
      id: 're_bea',
      jerseyNumber: '23',
    });

    const res = await buildApp(db, coach).request(
      `/api/v1/coach/teams/${team}/roster/entries/${beaEntry}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jerseyNumber: '11' }),
      },
      STUB_ENV,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as PatchSuccessBody;
    expect(body.data.entry.jerseyNumber).toBe('11');
    expect(body.data.warnings?.duplicateJerseyNumber).toBe(true);
  });

  it('rejects an empty patch with 400 INVALID_INPUT', async () => {
    const db = freshCoachDb();
    seedOrg(db, ORG_A);
    const team = seedTeam(db, ORG_A, 't_one');
    const coach = actor(ORG_A);
    seedUser(db, ORG_A, coach.userId, coach.email);
    seedCoachAssignment(db, ORG_A, team, coach.userId);
    const athlete = seedUser(db, ORG_A, 'u_ada');
    const entryId = seedRosterEntry(db, ORG_A, team, athlete);

    const res = await buildApp(db, coach).request(
      `/api/v1/coach/teams/${team}/roster/entries/${entryId}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      },
      STUB_ENV,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('INVALID_INPUT');
  });

  it('returns a single user-facing error.message + field for invalid jerseyNumber (Story #989)', async () => {
    const db = freshCoachDb();
    seedOrg(db, ORG_A);
    const team = seedTeam(db, ORG_A, 't_one');
    const coach = actor(ORG_A);
    seedUser(db, ORG_A, coach.userId, coach.email);
    seedCoachAssignment(db, ORG_A, team, coach.userId);
    const athlete = seedUser(db, ORG_A, 'u_ada');
    const entryId = seedRosterEntry(db, ORG_A, team, athlete);

    const res = await buildApp(db, coach).request(
      `/api/v1/coach/teams/${team}/roster/entries/${entryId}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jerseyNumber: 'abc' }),
      },
      STUB_ENV,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorBody & { error: { field?: string } };
    expect(body.error.code).toBe('INVALID_INPUT');
    // The message must NOT be a JSON-encoded Zod issue array (the bug
    // Story #989 fixes). It must be a plain user-facing sentence.
    expect(body.error.message).not.toMatch(/^\[/);
    expect(body.error.message).toContain('jerseyNumber');
    expect(body.error.field).toBe('jerseyNumber');
  });

  it('falls back to "Invalid input." when the body is not valid JSON', async () => {
    const db = freshCoachDb();
    seedOrg(db, ORG_A);
    const team = seedTeam(db, ORG_A, 't_one');
    const coach = actor(ORG_A);
    seedUser(db, ORG_A, coach.userId, coach.email);
    seedCoachAssignment(db, ORG_A, team, coach.userId);
    const athlete = seedUser(db, ORG_A, 'u_ada');
    const entryId = seedRosterEntry(db, ORG_A, team, athlete);

    const res = await buildApp(db, coach).request(
      `/api/v1/coach/teams/${team}/roster/entries/${entryId}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: 'not-json',
      },
      STUB_ENV,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('INVALID_INPUT');
    expect(body.error.message).toBe('Invalid input.');
  });

  it('returns 404 when the coach is on a different team in the same org', async () => {
    const db = freshCoachDb();
    seedOrg(db, ORG_A);
    const teamMine = seedTeam(db, ORG_A, 't_mine');
    const teamOther = seedTeam(db, ORG_A, 't_other');
    const coach = actor(ORG_A);
    seedUser(db, ORG_A, coach.userId, coach.email);
    seedCoachAssignment(db, ORG_A, teamMine, coach.userId);
    const athlete = seedUser(db, ORG_A, 'u_ada');
    const entryId = seedRosterEntry(db, ORG_A, teamOther, athlete);

    const res = await buildApp(db, coach).request(
      `/api/v1/coach/teams/${teamOther}/roster/entries/${entryId}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jerseyNumber: '99' }),
      },
      STUB_ENV,
    );

    expect(res.status).toBe(404);

    // Defense-in-depth: the row was untouched.
    const rows = db.select().from(rosterEntries).where(eq(rosterEntries.id, entryId)).all();
    expect(rows[0]?.jerseyNumber).toBe('7');
  });

  it('returns 404 when the coach is on a team in a different org', async () => {
    const db = freshCoachDb();
    seedOrg(db, ORG_A);
    seedOrg(db, ORG_B);
    const teamA = seedTeam(db, ORG_A, 't_a');
    const teamB = seedTeam(db, ORG_B, 't_b');
    const coachA = actor(ORG_A);
    seedUser(db, ORG_A, coachA.userId, coachA.email);
    seedCoachAssignment(db, ORG_A, teamA, coachA.userId);
    const athleteB = seedUser(db, ORG_B, 'u_b_ath');
    const entryB = seedRosterEntry(db, ORG_B, teamB, athleteB, { id: 're_b' });

    const res = await buildApp(db, coachA).request(
      `/api/v1/coach/teams/${teamB}/roster/entries/${entryB}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jerseyNumber: '99' }),
      },
      STUB_ENV,
    );

    expect(res.status).toBe(404);
    const rows = db.select().from(rosterEntries).where(eq(rosterEntries.id, entryB)).all();
    expect(rows[0]?.jerseyNumber).toBe('7');
  });
});

describe('DELETE /api/v1/coach/teams/:teamId/roster/entries/:entryId', () => {
  it('sets ended_at and the entry no longer surfaces in the list', async () => {
    const db = freshCoachDb();
    seedOrg(db, ORG_A);
    const team = seedTeam(db, ORG_A, 't_one');
    const coach = actor(ORG_A);
    seedUser(db, ORG_A, coach.userId, coach.email);
    seedCoachAssignment(db, ORG_A, team, coach.userId);
    const athlete = seedUser(db, ORG_A, 'u_ada');
    const entryId = seedRosterEntry(db, ORG_A, team, athlete);

    const harness = buildApp(db, coach);
    const res = await harness.request(
      `/api/v1/coach/teams/${team}/roster/entries/${entryId}`,
      { method: 'DELETE' },
      STUB_ENV,
    );

    expect(res.status).toBe(204);

    // DB assertion: ended_at is now set on the row.
    const rows = db.select().from(rosterEntries).where(eq(rosterEntries.id, entryId)).all();
    expect(rows[0]?.endedAt).not.toBeNull();

    // Behavioural assertion: the entry no longer surfaces in the list.
    const list = await harness.request(
      `/api/v1/coach/teams/${team}/roster`,
      { method: 'GET' },
      STUB_ENV,
    );
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as {
      success: boolean;
      data: { items: Array<{ id: string }> };
    };
    expect(listBody.data.items.map((i) => i.id)).not.toContain(entryId);
  });

  it('is idempotent — a second DELETE on the same id still returns 204', async () => {
    const db = freshCoachDb();
    seedOrg(db, ORG_A);
    const team = seedTeam(db, ORG_A, 't_one');
    const coach = actor(ORG_A);
    seedUser(db, ORG_A, coach.userId, coach.email);
    seedCoachAssignment(db, ORG_A, team, coach.userId);
    const athlete = seedUser(db, ORG_A, 'u_ada');
    const entryId = seedRosterEntry(db, ORG_A, team, athlete);

    const harness = buildApp(db, coach);
    const first = await harness.request(
      `/api/v1/coach/teams/${team}/roster/entries/${entryId}`,
      { method: 'DELETE' },
      STUB_ENV,
    );
    expect(first.status).toBe(204);

    const second = await harness.request(
      `/api/v1/coach/teams/${team}/roster/entries/${entryId}`,
      { method: 'DELETE' },
      STUB_ENV,
    );
    expect(second.status).toBe(204);
  });

  it('returns 404 when the coach is on a team in a different org', async () => {
    const db = freshCoachDb();
    seedOrg(db, ORG_A);
    seedOrg(db, ORG_B);
    const teamA = seedTeam(db, ORG_A, 't_a');
    const teamB = seedTeam(db, ORG_B, 't_b');
    const coachA = actor(ORG_A);
    seedUser(db, ORG_A, coachA.userId, coachA.email);
    seedCoachAssignment(db, ORG_A, teamA, coachA.userId);
    const athleteB = seedUser(db, ORG_B, 'u_b_ath');
    const entryB = seedRosterEntry(db, ORG_B, teamB, athleteB, { id: 're_b' });

    const res = await buildApp(db, coachA).request(
      `/api/v1/coach/teams/${teamB}/roster/entries/${entryB}`,
      { method: 'DELETE' },
      STUB_ENV,
    );

    expect(res.status).toBe(404);

    // Defense-in-depth: the row was untouched.
    const rows = db.select().from(rosterEntries).where(eq(rosterEntries.id, entryB)).all();
    expect(rows[0]?.endedAt).toBeNull();
  });
});
