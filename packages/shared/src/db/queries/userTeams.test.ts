// packages/shared/src/db/queries/userTeams.test.ts
//
// Unit tests for the dashboard "teams this user belongs to" reader
// (Story #985 / F27). Exercises the query against an ephemeral
// better-sqlite3 schema handle so the coach/athlete UNION, the
// active-only filters, and the Clerk-subject resolution are pinned.

import { describe, expect, it } from 'vitest';
import { freshSchemaDb } from '../schema/__tests__/freshSchemaDb';
import { athleteMemberships } from '../schema/athleteMemberships';
import { coachAssignments } from '../schema/coachAssignments';
import { organizations } from '../schema/organizations';
import { teams } from '../schema/teams';
import { users } from '../schema/users';
import { listUserTeamsBySubject } from './userTeams';

type Db = ReturnType<typeof freshSchemaDb>;

const ORG = 'org_test';

function seedOrg(db: Db): void {
  db.insert(organizations)
    .values({ id: ORG, name: 'Org', organizationType: 'CLUB' })
    .onConflictDoNothing()
    .run();
}

function seedTeam(db: Db, id: string, opts: { archivedAt?: Date; deletedAt?: Date } = {}): string {
  db.insert(teams)
    .values({
      id,
      orgId: ORG,
      name: `Team ${id}`,
      sport: 'Volleyball',
      season: 'Fall 2026',
      ageGroup: 'U14',
      archivedAt: opts.archivedAt ?? null,
      deletedAt: opts.deletedAt ?? null,
    })
    .run();
  return id;
}

function seedUser(db: Db, id: string, subject: string): string {
  db.insert(users)
    .values({
      id,
      clerkSubjectId: subject,
      email: `${id}@test.invalid`,
      role: 'member',
      orgId: ORG,
      teamId: null,
    })
    .run();
  return id;
}

function seedCoach(db: Db, teamId: string, userId: string, endedAt: Date | null = null): void {
  db.insert(coachAssignments)
    .values({ id: `ca_${teamId}_${userId}`, orgId: ORG, teamId, coachUserId: userId, endedAt })
    .run();
}

function seedAthlete(db: Db, teamId: string, userId: string, endedAt: Date | null = null): void {
  db.insert(athleteMemberships)
    .values({ id: `am_${teamId}_${userId}`, orgId: ORG, teamId, athleteUserId: userId, endedAt })
    .run();
}

describe('listUserTeamsBySubject', () => {
  it('returns coach teams then athlete teams for the subject', () => {
    const db = freshSchemaDb();
    seedOrg(db);
    const coachTeam = seedTeam(db, 't_coach');
    const athleteTeam = seedTeam(db, 't_athlete');
    const userId = seedUser(db, 'u_one', 'clerk_one');
    seedCoach(db, coachTeam, userId);
    seedAthlete(db, athleteTeam, userId);

    const rows = listUserTeamsBySubject(db, 'clerk_one');

    expect(rows).toEqual([
      { teamId: 't_coach', teamName: 'Team t_coach', role: 'coach' },
      { teamId: 't_athlete', teamName: 'Team t_athlete', role: 'athlete' },
    ]);
  });

  it('returns an empty array when the subject resolves to no user', () => {
    const db = freshSchemaDb();
    seedOrg(db);
    expect(listUserTeamsBySubject(db, 'clerk_missing')).toEqual([]);
  });

  it('excludes end-dated assignments and memberships', () => {
    const db = freshSchemaDb();
    seedOrg(db);
    const active = seedTeam(db, 't_active');
    const ended = seedTeam(db, 't_ended');
    const userId = seedUser(db, 'u_one', 'clerk_one');
    seedCoach(db, active, userId);
    seedCoach(db, ended, userId, new Date('2026-01-01T00:00:00.000Z'));

    const rows = listUserTeamsBySubject(db, 'clerk_one');

    expect(rows.map((r) => r.teamId)).toEqual(['t_active']);
  });

  it('excludes archived and soft-deleted teams', () => {
    const db = freshSchemaDb();
    seedOrg(db);
    const live = seedTeam(db, 't_live');
    const archived = seedTeam(db, 't_archived', { archivedAt: new Date('2026-01-01') });
    const deleted = seedTeam(db, 't_deleted', { deletedAt: new Date('2026-01-01') });
    const userId = seedUser(db, 'u_one', 'clerk_one');
    seedCoach(db, live, userId);
    seedCoach(db, archived, userId);
    seedCoach(db, deleted, userId);

    const rows = listUserTeamsBySubject(db, 'clerk_one');

    expect(rows.map((r) => r.teamId)).toEqual(['t_live']);
  });

  it('surfaces a team the user both coaches and plays on as two rows', () => {
    const db = freshSchemaDb();
    seedOrg(db);
    const team = seedTeam(db, 't_both');
    const userId = seedUser(db, 'u_one', 'clerk_one');
    seedCoach(db, team, userId);
    seedAthlete(db, team, userId);

    const rows = listUserTeamsBySubject(db, 'clerk_one');

    expect(rows).toEqual([
      { teamId: 't_both', teamName: 'Team t_both', role: 'coach' },
      { teamId: 't_both', teamName: 'Team t_both', role: 'athlete' },
    ]);
  });
});
