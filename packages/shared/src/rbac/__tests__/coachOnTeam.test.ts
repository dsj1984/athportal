/**
 * Unit tests for the `requireCoachOnTeam` authorization predicate
 * (Epic #11 / Story #910 / Task #913).
 *
 * Exercises every refused-path the Tech Spec §Authorization predicate
 * pins:
 *   - active matching assignment passes
 *   - ended assignment refused
 *   - wrong team refused
 *   - wrong actor refused
 *
 * Uses the `freshSchemaDb` test helper (sibling of the contract suite
 * for the join tables it queries) so the predicate runs against the
 * same migration surface production uses. The Drizzle query inside the
 * helper is small enough to make a hand-rolled fake error-prone — a
 * real in-memory SQLite + a few seeded rows is both clearer and
 * stronger against future migration drift.
 */

import { describe, expect, it } from 'vitest';
import { coachAssignments } from '../../db/schema/coachAssignments';
import { organizations } from '../../db/schema/organizations';
import { teams } from '../../db/schema/teams';
import { users } from '../../db/schema/users';
import { freshSchemaDb } from '../../db/schema/__tests__/freshSchemaDb';
import type { AuthContext } from '../types';
import { HttpError, requireCoachOnTeam } from '../coachOnTeam';

interface World {
  db: ReturnType<typeof freshSchemaDb>;
  coachActor: AuthContext;
  otherCoachActor: AuthContext;
  team1: string;
  team2: string;
}

async function seedWorld(): Promise<World> {
  const db = freshSchemaDb();
  const orgId = 'org_A';
  const team1 = 'team_1';
  const team2 = 'team_2';
  const coachUserId = 'u_coach';
  const otherCoachUserId = 'u_coach_other';

  await db
    .insert(organizations)
    .values({ id: orgId, name: 'Org A', organizationType: 'HIGH_SCHOOL' });
  await db.insert(teams).values([
    { id: team1, orgId, name: 'Team 1' },
    { id: team2, orgId, name: 'Team 2' },
  ]);
  await db.insert(users).values([
    {
      id: coachUserId,
      clerkSubjectId: 'clerk_coach',
      email: 'coach@example.invalid',
      role: 'team_admin',
      orgId,
      teamId: team1,
    },
    {
      id: otherCoachUserId,
      clerkSubjectId: 'clerk_coach_other',
      email: 'coach-other@example.invalid',
      role: 'team_admin',
      orgId,
      teamId: team2,
    },
  ]);
  // Active assignment: coach → team1.
  await db.insert(coachAssignments).values({
    id: 'ca_active',
    orgId,
    teamId: team1,
    coachUserId,
  });
  // Ended assignment: otherCoach → team1 (ended_at set).
  await db.insert(coachAssignments).values({
    id: 'ca_ended',
    orgId,
    teamId: team1,
    coachUserId: otherCoachUserId,
    endedAt: new Date('2025-01-01T00:00:00Z'),
  });
  // Active assignment for otherCoach on team2 — used as a positive
  // control to ensure the predicate is per-team, not per-coach.
  await db.insert(coachAssignments).values({
    id: 'ca_other_active',
    orgId,
    teamId: team2,
    coachUserId: otherCoachUserId,
  });

  const coachActor: AuthContext = {
    userId: coachUserId,
    clerkSubjectId: 'clerk_coach',
    role: 'team_admin',
    orgId,
    teamId: team1,
  };
  const otherCoachActor: AuthContext = {
    userId: otherCoachUserId,
    clerkSubjectId: 'clerk_coach_other',
    role: 'team_admin',
    orgId,
    teamId: team2,
  };

  return { db, coachActor, otherCoachActor, team1, team2 };
}

describe('requireCoachOnTeam — happy path', () => {
  it('resolves when the actor has an active assignment on the team', async () => {
    const { db, coachActor, team1 } = await seedWorld();
    await expect(requireCoachOnTeam(coachActor, team1, db)).resolves.toBeUndefined();
  });
});

describe('requireCoachOnTeam — refusals', () => {
  it('throws HttpError(404) when the actor coaches a different team', async () => {
    const { db, coachActor, team2 } = await seedWorld();
    // coachActor is on team1; querying team2 should refuse even
    // though the team exists in the same org.
    await expect(requireCoachOnTeam(coachActor, team2, db)).rejects.toBeInstanceOf(HttpError);
    await expect(requireCoachOnTeam(coachActor, team2, db)).rejects.toMatchObject({
      status: 404,
      message: 'team-not-found',
    });
  });

  it('throws when the actor has an ended assignment on the team', async () => {
    const { db, otherCoachActor, team1 } = await seedWorld();
    // otherCoachActor has an ended assignment on team1 — must be
    // refused even though the row exists.
    await expect(requireCoachOnTeam(otherCoachActor, team1, db)).rejects.toBeInstanceOf(HttpError);
    await expect(requireCoachOnTeam(otherCoachActor, team1, db)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('throws when the actor has no assignment at all on the team', async () => {
    const { db, team1 } = await seedWorld();
    const strangerActor: AuthContext = {
      userId: 'u_stranger',
      clerkSubjectId: 'clerk_stranger',
      role: 'team_admin',
      orgId: 'org_A',
      teamId: team1,
    };
    await expect(requireCoachOnTeam(strangerActor, team1, db)).rejects.toBeInstanceOf(HttpError);
  });

  it('throws when the team does not exist', async () => {
    const { db, coachActor } = await seedWorld();
    await expect(
      requireCoachOnTeam(coachActor, 'team_nonexistent', db),
    ).rejects.toBeInstanceOf(HttpError);
  });
});

describe('HttpError', () => {
  it('carries the supplied status and message', () => {
    const err = new HttpError(404, 'team-not-found');
    expect(err.status).toBe(404);
    expect(err.message).toBe('team-not-found');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('HttpError');
  });
});
