/**
 * Unit tests for the persona-graph fixture seed.
 *
 * The seed is load-bearing for the QA-corpus agent runner — every
 * `/admin/*` plan signs in as one of the three fixture personas and
 * expects the org / team graph to be present in the local DB. The
 * tests pin the two contractual guarantees named in Task #887: the
 * full graph lands in one call, and idempotence on re-run.
 *
 * Test DB scope — `seedFixtures` writes to tables introduced across
 * migrations 0000 (auth_and_rbac), 0002 (org_team_graph), 0004
 * (org_branding), 0005 (team_metadata), and 0007 (roster). The bespoke
 * `freshDb()` helper at the bottom of this file applies the full
 * migration chain so the assertions exercise the production schema
 * verbatim.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database, { type Database as SqliteDatabase } from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { describe, expect, it } from 'vitest';
import { athleteMemberships } from './schema/athleteMemberships';
import { coachAssignments } from './schema/coachAssignments';
import { organizations } from './schema/organizations';
import { rosterEntries } from './schema/rosterEntries';
import { teams } from './schema/teams';
import { users } from './schema/users';
import { SEED_BOOTSTRAP_EFFECTIVE_AT } from './seed';
import {
  SEED_FIXTURE_ATHLETE_A2_USER_ID,
  SEED_FIXTURE_ATHLETE_B1_USER_ID,
  SEED_FIXTURE_ATHLETE_B_USER_ID,
  SEED_FIXTURE_ATHLETE_USER_ID,
  SEED_FIXTURE_COACH_ASSIGNMENT_ID,
  SEED_FIXTURE_COACH_USER_ID,
  SEED_FIXTURE_ORG_ADMIN_USER_ID,
  SEED_FIXTURE_ORG_B_ID,
  SEED_FIXTURE_ORG_ID,
  SEED_FIXTURE_ROSTER_ENTRY_B_ID,
  SEED_FIXTURE_ROSTER_ENTRY_ID,
  SEED_FIXTURE_ROSTER_JERSEY_NUMBER,
  SEED_FIXTURE_ROSTER_PRIMARY_POSITION,
  SEED_FIXTURE_TEAM_A2_ID,
  SEED_FIXTURE_TEAM_B1_ID,
  SEED_FIXTURE_TEAM_ID,
  seedFixtures,
} from './seedFixtures';

describe('seedFixtures', () => {
  it('writes both orgs, all persona + athlete users, three teams, the membership/assignment rows, and the active roster entries', () => {
    const db = freshDb();

    seedFixtures(db);

    const orgs = db.select().from(organizations).all();
    expect(orgs.map((o) => o.id).sort()).toEqual(
      [SEED_FIXTURE_ORG_ID, SEED_FIXTURE_ORG_B_ID].sort(),
    );
    const orgA = orgs.find((o) => o.id === SEED_FIXTURE_ORG_ID);
    expect(orgA?.organizationType).toBe('CLUB');

    const userRows = db.select().from(users).all();
    expect(userRows).toHaveLength(6);
    const userIds = userRows.map((u) => u.id).sort();
    expect(userIds).toEqual(
      [
        SEED_FIXTURE_ATHLETE_USER_ID,
        SEED_FIXTURE_COACH_USER_ID,
        SEED_FIXTURE_ORG_ADMIN_USER_ID,
        SEED_FIXTURE_ATHLETE_B_USER_ID,
        SEED_FIXTURE_ATHLETE_A2_USER_ID,
        SEED_FIXTURE_ATHLETE_B1_USER_ID,
      ].sort(),
    );
    // The other-org athlete is scoped to org_test_b.
    const b1 = userRows.find((u) => u.id === SEED_FIXTURE_ATHLETE_B1_USER_ID);
    expect(b1?.orgId).toBe(SEED_FIXTURE_ORG_B_ID);

    const teamRows = db.select().from(teams).all();
    expect(teamRows.map((t) => t.id).sort()).toEqual(
      [SEED_FIXTURE_TEAM_ID, SEED_FIXTURE_TEAM_A2_ID, SEED_FIXTURE_TEAM_B1_ID].sort(),
    );

    const memberships = db.select().from(athleteMemberships).all();
    expect(memberships).toHaveLength(4);

    const assignments = db.select().from(coachAssignments).all();
    expect(assignments).toHaveLength(1);
    expect(assignments[0]?.id).toBe(SEED_FIXTURE_COACH_ASSIGNMENT_ID);
    expect(assignments[0]?.coachUserId).toBe(SEED_FIXTURE_COACH_USER_ID);

    const roster = db.select().from(rosterEntries).all();
    expect(roster).toHaveLength(4);
    const original = roster.find((r) => r.id === SEED_FIXTURE_ROSTER_ENTRY_ID);
    expect(original?.athleteUserId).toBe(SEED_FIXTURE_ATHLETE_USER_ID);
    expect(original?.teamId).toBe(SEED_FIXTURE_TEAM_ID);
    expect(original?.jerseyNumber).toBe(SEED_FIXTURE_ROSTER_JERSEY_NUMBER);
    expect(original?.primaryPosition).toBe(SEED_FIXTURE_ROSTER_PRIMARY_POSITION);
    expect(original?.endedAt).toBeNull();
    // F31 control row shares the coach's team.
    const control = roster.find((r) => r.id === SEED_FIXTURE_ROSTER_ENTRY_B_ID);
    expect(control?.teamId).toBe(SEED_FIXTURE_TEAM_ID);
  });

  it('pins onboarded_at on every persona user to SEED_BOOTSTRAP_EFFECTIVE_AT', () => {
    const db = freshDb();

    seedFixtures(db);

    const userRows = db.select().from(users).all();
    for (const row of userRows) {
      expect(row.onboardedAt?.getTime()).toBe(SEED_BOOTSTRAP_EFFECTIVE_AT.getTime());
    }
  });

  it('roles match the PERSONA_FIXTURES contract — athlete=member, coach=team_admin, org-admin=org_admin', () => {
    const db = freshDb();

    seedFixtures(db);

    const athlete = db
      .select()
      .from(users)
      .where(eq(users.id, SEED_FIXTURE_ATHLETE_USER_ID))
      .all()[0];
    const coach = db.select().from(users).where(eq(users.id, SEED_FIXTURE_COACH_USER_ID)).all()[0];
    const orgAdmin = db
      .select()
      .from(users)
      .where(eq(users.id, SEED_FIXTURE_ORG_ADMIN_USER_ID))
      .all()[0];

    expect(athlete?.role).toBe('member');
    expect(coach?.role).toBe('team_admin');
    expect(orgAdmin?.role).toBe('org_admin');
  });

  it('is idempotent — re-running does not duplicate rows', () => {
    const db = freshDb();

    seedFixtures(db);
    seedFixtures(db);
    seedFixtures(db);

    expect(db.select().from(organizations).all()).toHaveLength(2);
    expect(db.select().from(users).all()).toHaveLength(6);
    expect(db.select().from(teams).all()).toHaveLength(3);
    expect(db.select().from(athleteMemberships).all()).toHaveLength(4);
    expect(db.select().from(coachAssignments).all()).toHaveLength(1);
    expect(db.select().from(rosterEntries).all()).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// Test-only DB helper. Applies the full migration chain 0000–0005 so the
// seed exercises the production schema (including the team metadata columns
// 0005 added).
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const migrationsDir = join(__filename, '..', 'migrations');

const FIXTURE_MIGRATIONS = [
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
];

const schema = {
  athleteMemberships,
  coachAssignments,
  organizations,
  rosterEntries,
  teams,
  users,
};

function loadMigration(filename: string): string {
  return readFileSync(join(migrationsDir, filename), 'utf8');
}

function applyMigration(client: SqliteDatabase, sql: string): void {
  const statements = sql
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const stmt of statements) {
    client.exec(stmt);
  }
}

function freshDb() {
  const client = new Database(':memory:');
  client.pragma('foreign_keys = ON');
  for (const filename of FIXTURE_MIGRATIONS) {
    applyMigration(client, loadMigration(filename));
  }
  return drizzle(client, { schema });
}
