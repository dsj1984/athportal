/**
 * Contract test — team soft-delete preserves athlete profiles
 * (Story #617, Task #630).
 *
 * Pins the persistence-layer contract for team soft-delete (PRD #595,
 * Tech Spec #596 §Data Models):
 *
 *   1. Setting `teams.deleted_at` and end-dating the team's
 *      `athlete_memberships.ended_at` / `coach_assignments.ended_at`
 *      MUST NOT cascade into the underlying `users` rows. Athlete and
 *      coach user profiles outlive the team's roster lifecycle so that
 *      the user can be re-added to a future team without re-onboarding.
 *
 *   2. A soft-deleted team row remains queryable when callers explicitly
 *      opt in via `where deleted_at IS NOT NULL` (the 30-day recovery
 *      window). The default scoped reads filter it out — that filter
 *      lives in `scopedDb` (Story #607) and has its own contract test.
 *
 * Mirrors the trigger-less schema columns on `teams.deleted_at`,
 * `coach_assignments.ended_at`, and `athlete_memberships.ended_at`
 * landed by migration 0002 (Story #609).
 */

import { and, eq, isNotNull } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { athleteMemberships } from '../athleteMemberships';
import { coachAssignments } from '../coachAssignments';
import { organizations } from '../organizations';
import { teams } from '../teams';
import { users } from '../users';
import { freshSchemaDb } from './freshSchemaDb';

interface SoftDeleteWorld {
  db: ReturnType<typeof freshSchemaDb>;
  orgId: string;
  teamId: string;
  athleteId: string;
  coachId: string;
  athleteEmail: string;
  coachEmail: string;
  membershipId: string;
  assignmentId: string;
}

async function seedTeamWithRoster(): Promise<SoftDeleteWorld> {
  const db = freshSchemaDb();
  const orgId = 'org_1';
  const teamId = 'team_1';
  const athleteId = 'u_athlete';
  const coachId = 'u_coach';
  const athleteEmail = 'athlete@example.invalid';
  const coachEmail = 'coach@example.invalid';
  const membershipId = 'am_1';
  const assignmentId = 'ca_1';

  await db
    .insert(organizations)
    .values({ id: orgId, name: 'Org 1', organizationType: 'COLLEGE' });
  await db.insert(teams).values({ id: teamId, orgId, name: 'Team 1' });
  await db.insert(users).values([
    {
      id: athleteId,
      clerkSubjectId: 'clerk_athlete',
      email: athleteEmail,
      role: 'member',
      orgId,
      teamId,
    },
    {
      id: coachId,
      clerkSubjectId: 'clerk_coach',
      email: coachEmail,
      role: 'team_admin',
      orgId,
      teamId,
    },
  ]);
  await db
    .insert(athleteMemberships)
    .values({ id: membershipId, orgId, teamId, athleteUserId: athleteId });
  await db
    .insert(coachAssignments)
    .values({ id: assignmentId, orgId, teamId, coachUserId: coachId });

  return {
    db,
    orgId,
    teamId,
    athleteId,
    coachId,
    athleteEmail,
    coachEmail,
    membershipId,
    assignmentId,
  };
}

/**
 * Apply the canonical soft-delete sequence: stamp `teams.deleted_at`
 * and end-date every active roster row for the team. Mirrors the
 * expected behavior of the not-yet-built soft-delete handler so the
 * contract test can pin the persistence shape.
 */
async function applySoftDelete(world: SoftDeleteWorld, deletedAt: Date): Promise<void> {
  await world.db.update(teams).set({ deletedAt }).where(eq(teams.id, world.teamId));
  await world.db
    .update(athleteMemberships)
    .set({ endedAt: deletedAt })
    .where(eq(athleteMemberships.teamId, world.teamId));
  await world.db
    .update(coachAssignments)
    .set({ endedAt: deletedAt })
    .where(eq(coachAssignments.teamId, world.teamId));
}

describe('team soft-delete — roster end-dating', () => {
  it('sets ended_at on every athlete membership for the team', async () => {
    const world = await seedTeamWithRoster();
    const deletedAt = new Date('2026-01-15T00:00:00Z');

    await applySoftDelete(world, deletedAt);

    const membership = await world.db.query.athleteMemberships.findFirst({
      where: eq(athleteMemberships.id, world.membershipId),
    });
    expect(membership).toBeDefined();
    expect(membership?.endedAt?.toISOString()).toBe(deletedAt.toISOString());
  });

  it('sets ended_at on every coach assignment for the team', async () => {
    const world = await seedTeamWithRoster();
    const deletedAt = new Date('2026-01-15T00:00:00Z');

    await applySoftDelete(world, deletedAt);

    const assignment = await world.db.query.coachAssignments.findFirst({
      where: eq(coachAssignments.id, world.assignmentId),
    });
    expect(assignment).toBeDefined();
    expect(assignment?.endedAt?.toISOString()).toBe(deletedAt.toISOString());
  });
});

describe('team soft-delete — user profiles outlive the team', () => {
  it('does not delete or mutate the athlete user row', async () => {
    const world = await seedTeamWithRoster();
    const before = await world.db.query.users.findFirst({
      where: eq(users.id, world.athleteId),
    });
    expect(before).toBeDefined();

    await applySoftDelete(world, new Date('2026-01-15T00:00:00Z'));

    const after = await world.db.query.users.findFirst({
      where: eq(users.id, world.athleteId),
    });
    expect(after).toBeDefined();
    expect(after?.email).toBe(world.athleteEmail);
    expect(after?.orgId).toBe(world.orgId);
    // The athlete still claims membership in `team_1` via `users.team_id` —
    // resetting that pointer is application-layer cleanup, not schema-layer.
    expect(after?.teamId).toBe(world.teamId);
  });

  it('does not delete or mutate the coach user row', async () => {
    const world = await seedTeamWithRoster();

    await applySoftDelete(world, new Date('2026-01-15T00:00:00Z'));

    const after = await world.db.query.users.findFirst({
      where: eq(users.id, world.coachId),
    });
    expect(after).toBeDefined();
    expect(after?.email).toBe(world.coachEmail);
    expect(after?.role).toBe('team_admin');
  });
});

describe('team soft-delete — 30-day recovery query', () => {
  it('keeps the team row queryable when callers opt in to deleted_at IS NOT NULL', async () => {
    const world = await seedTeamWithRoster();
    const deletedAt = new Date('2026-01-15T00:00:00Z');

    await applySoftDelete(world, deletedAt);

    const recoverable = await world.db.query.teams.findFirst({
      where: and(eq(teams.id, world.teamId), isNotNull(teams.deletedAt)),
    });
    expect(recoverable).toBeDefined();
    expect(recoverable?.id).toBe(world.teamId);
    expect(recoverable?.deletedAt?.toISOString()).toBe(deletedAt.toISOString());
  });
});
