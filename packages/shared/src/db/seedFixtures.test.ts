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
 * (org_branding), and 0005 (team_metadata). The bespoke `freshDb()`
 * helper at the bottom of this file applies the full migration chain
 * so the assertions exercise the production schema verbatim.
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
import { teams } from './schema/teams';
import { users } from './schema/users';
import { SEED_BOOTSTRAP_EFFECTIVE_AT } from './seed';
import {
  SEED_FIXTURE_ATHLETE_MEMBERSHIP_ID,
  SEED_FIXTURE_ATHLETE_USER_ID,
  SEED_FIXTURE_COACH_ASSIGNMENT_ID,
  SEED_FIXTURE_COACH_USER_ID,
  SEED_FIXTURE_ORG_ADMIN_USER_ID,
  SEED_FIXTURE_ORG_ID,
  SEED_FIXTURE_TEAM_ID,
  seedFixtures,
} from './seedFixtures';

describe('seedFixtures', () => {
  it('writes one org, three persona users, one team, and the membership/assignment rows', () => {
    const db = freshDb();

    seedFixtures(db);

    const orgs = db.select().from(organizations).all();
    expect(orgs).toHaveLength(1);
    expect(orgs[0]?.id).toBe(SEED_FIXTURE_ORG_ID);
    expect(orgs[0]?.organizationType).toBe('CLUB');

    const userRows = db.select().from(users).all();
    expect(userRows).toHaveLength(3);
    const userIds = userRows.map((u) => u.id).sort();
    expect(userIds).toEqual(
      [
        SEED_FIXTURE_ATHLETE_USER_ID,
        SEED_FIXTURE_COACH_USER_ID,
        SEED_FIXTURE_ORG_ADMIN_USER_ID,
      ].sort(),
    );

    const teamRows = db.select().from(teams).all();
    expect(teamRows).toHaveLength(1);
    expect(teamRows[0]?.id).toBe(SEED_FIXTURE_TEAM_ID);
    expect(teamRows[0]?.orgId).toBe(SEED_FIXTURE_ORG_ID);

    const memberships = db.select().from(athleteMemberships).all();
    expect(memberships).toHaveLength(1);
    expect(memberships[0]?.id).toBe(SEED_FIXTURE_ATHLETE_MEMBERSHIP_ID);
    expect(memberships[0]?.athleteUserId).toBe(SEED_FIXTURE_ATHLETE_USER_ID);

    const assignments = db.select().from(coachAssignments).all();
    expect(assignments).toHaveLength(1);
    expect(assignments[0]?.id).toBe(SEED_FIXTURE_COACH_ASSIGNMENT_ID);
    expect(assignments[0]?.coachUserId).toBe(SEED_FIXTURE_COACH_USER_ID);
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

    expect(db.select().from(organizations).all()).toHaveLength(1);
    expect(db.select().from(users).all()).toHaveLength(3);
    expect(db.select().from(teams).all()).toHaveLength(1);
    expect(db.select().from(athleteMemberships).all()).toHaveLength(1);
    expect(db.select().from(coachAssignments).all()).toHaveLength(1);
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
];

const schema = {
  athleteMemberships,
  coachAssignments,
  organizations,
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
