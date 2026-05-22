/**
 * Contract test for `scopedDb` cross-tenant isolation (Story #607,
 * Task #621).
 *
 * Pin the load-bearing security defense end-to-end against a real
 * ephemeral SQLite. Seed two orgs each with a team, a coach, an
 * athlete, a coachAssignment, and an athleteMembership; then prove
 * that an `scopedDb(actor)` view bound to org A NEVER returns rows
 * owned by org B — no matter which of the five graph tables the
 * read targets.
 *
 * Tech Spec #596 §Security & Privacy Considerations names this test
 * as the launch-blocking contract. The matching unit-tier coverage
 * lives at `../scopedDb.test.ts` (Task #622).
 */

import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AuthContext } from '../../../rbac/types';
import { athleteMemberships } from '../../schema/athleteMemberships';
import { coachAssignments } from '../../schema/coachAssignments';
import { organizations } from '../../schema/organizations';
import { teams } from '../../schema/teams';
import { users } from '../../schema/users';
import { type ScopedDbHandle, scopedDb } from '../scopedDb';
import { type GraphTestDb, freshGraphDb } from './graphDb';

interface SeededWorld {
  db: GraphTestDb;
  orgA: { id: string; teamId: string; coachId: string; athleteId: string };
  orgB: { id: string; teamId: string; coachId: string; athleteId: string };
}

async function seedTwoOrgs(): Promise<SeededWorld> {
  const db = freshGraphDb();
  const orgA = { id: 'org_A', teamId: 'team_A1', coachId: 'u_A_coach', athleteId: 'u_A_athlete' };
  const orgB = { id: 'org_B', teamId: 'team_B1', coachId: 'u_B_coach', athleteId: 'u_B_athlete' };

  // Organizations.
  await db.insert(organizations).values([
    { id: orgA.id, name: 'Org A', organizationType: 'CLUB' },
    { id: orgB.id, name: 'Org B', organizationType: 'CLUB' },
  ]);

  // Teams.
  await db.insert(teams).values([
    { id: orgA.teamId, orgId: orgA.id, name: 'Team A1' },
    { id: orgB.teamId, orgId: orgB.id, name: 'Team B1' },
  ]);

  // Users.
  await db.insert(users).values([
    {
      id: orgA.coachId,
      clerkSubjectId: 'clerk_A_coach',
      email: 'coach-a@example.invalid',
      role: 'team_admin',
      orgId: orgA.id,
      teamId: orgA.teamId,
    },
    {
      id: orgA.athleteId,
      clerkSubjectId: 'clerk_A_athlete',
      email: 'athlete-a@example.invalid',
      role: 'member',
      orgId: orgA.id,
      teamId: orgA.teamId,
    },
    {
      id: orgB.coachId,
      clerkSubjectId: 'clerk_B_coach',
      email: 'coach-b@example.invalid',
      role: 'team_admin',
      orgId: orgB.id,
      teamId: orgB.teamId,
    },
    {
      id: orgB.athleteId,
      clerkSubjectId: 'clerk_B_athlete',
      email: 'athlete-b@example.invalid',
      role: 'member',
      orgId: orgB.id,
      teamId: orgB.teamId,
    },
  ]);

  // Coach assignments.
  await db.insert(coachAssignments).values([
    { id: 'ca_A', orgId: orgA.id, teamId: orgA.teamId, coachUserId: orgA.coachId },
    { id: 'ca_B', orgId: orgB.id, teamId: orgB.teamId, coachUserId: orgB.coachId },
  ]);

  // Athlete memberships.
  await db.insert(athleteMemberships).values([
    { id: 'am_A', orgId: orgA.id, teamId: orgA.teamId, athleteUserId: orgA.athleteId },
    { id: 'am_B', orgId: orgB.id, teamId: orgB.teamId, athleteUserId: orgB.athleteId },
  ]);

  return { db, orgA, orgB };
}

function actorFor(orgId: string, role: AuthContext['role'] = 'org_admin'): AuthContext {
  return {
    userId: `u_actor_${orgId}`,
    clerkSubjectId: `clerk_actor_${orgId}`,
    role,
    orgId,
  };
}

function devAdminActor(): AuthContext {
  return {
    userId: 'u_dev',
    clerkSubjectId: 'clerk_dev',
    role: 'dev_admin',
  };
}

let world: SeededWorld;

beforeEach(async () => {
  world = await seedTwoOrgs();
});

afterEach(() => {
  // freshGraphDb opens a fresh `:memory:` SQLite per call — no shared
  // file, no shared state. Nothing to tear down explicitly.
  world = undefined as unknown as SeededWorld;
});

describe('scopedDb — cross-tenant findFirst returns undefined for foreign rows', () => {
  it('organizations: org_A actor cannot read org_B row by id', async () => {
    const scoped = scopedDb(world.db as unknown as ScopedDbHandle, actorFor(world.orgA.id));
    const leaked = await scoped.organizations.findFirst({
      where: eq(organizations.id, world.orgB.id),
    });
    expect(leaked).toBeUndefined();
  });

  it('teams: org_A actor cannot read org_B team by id', async () => {
    const scoped = scopedDb(world.db as unknown as ScopedDbHandle, actorFor(world.orgA.id));
    const leaked = await scoped.teams.findFirst({ where: eq(teams.id, world.orgB.teamId) });
    expect(leaked).toBeUndefined();
  });

  it('users: org_A actor cannot read org_B user by id', async () => {
    const scoped = scopedDb(world.db as unknown as ScopedDbHandle, actorFor(world.orgA.id));
    const leaked = await scoped.users.findFirst({ where: eq(users.id, world.orgB.coachId) });
    expect(leaked).toBeUndefined();
  });

  it('coachAssignments: org_A actor cannot read org_B assignment by id', async () => {
    const scoped = scopedDb(world.db as unknown as ScopedDbHandle, actorFor(world.orgA.id));
    const leaked = await scoped.coachAssignments.findFirst({
      where: eq(coachAssignments.id, 'ca_B'),
    });
    expect(leaked).toBeUndefined();
  });

  it('athleteMemberships: org_A actor cannot read org_B membership by id', async () => {
    const scoped = scopedDb(world.db as unknown as ScopedDbHandle, actorFor(world.orgA.id));
    const leaked = await scoped.athleteMemberships.findFirst({
      where: eq(athleteMemberships.id, 'am_B'),
    });
    expect(leaked).toBeUndefined();
  });
});

describe('scopedDb — cross-tenant findMany excludes foreign rows', () => {
  it('organizations: org_A actor sees only their own org row', async () => {
    const scoped = scopedDb(world.db as unknown as ScopedDbHandle, actorFor(world.orgA.id));
    const rows = await scoped.organizations.findMany();
    expect(rows).toHaveLength(1);
    expect((rows[0] as { id: string }).id).toBe(world.orgA.id);
  });

  it('teams: org_A actor sees only their own team', async () => {
    const scoped = scopedDb(world.db as unknown as ScopedDbHandle, actorFor(world.orgA.id));
    const rows = await scoped.teams.findMany();
    const ids = rows.map((r) => (r as { id: string }).id);
    expect(ids).toEqual([world.orgA.teamId]);
  });

  it('users: org_A actor sees only their own org users (2 of 4)', async () => {
    const scoped = scopedDb(world.db as unknown as ScopedDbHandle, actorFor(world.orgA.id));
    const rows = await scoped.users.findMany();
    const ids = rows.map((r) => (r as { id: string }).id).sort();
    expect(ids).toEqual([world.orgA.athleteId, world.orgA.coachId].sort());
  });

  it('coachAssignments: org_A actor sees only their own assignment', async () => {
    const scoped = scopedDb(world.db as unknown as ScopedDbHandle, actorFor(world.orgA.id));
    const rows = await scoped.coachAssignments.findMany();
    const ids = rows.map((r) => (r as { id: string }).id);
    expect(ids).toEqual(['ca_A']);
  });

  it('athleteMemberships: org_A actor sees only their own membership', async () => {
    const scoped = scopedDb(world.db as unknown as ScopedDbHandle, actorFor(world.orgA.id));
    const rows = await scoped.athleteMemberships.findMany();
    const ids = rows.map((r) => (r as { id: string }).id);
    expect(ids).toEqual(['am_A']);
  });
});

describe('scopedDb — same-tenant reads return the row', () => {
  it('org_A actor reads their own team via findFirst', async () => {
    const scoped = scopedDb(world.db as unknown as ScopedDbHandle, actorFor(world.orgA.id));
    const row = await scoped.teams.findFirst({ where: eq(teams.id, world.orgA.teamId) });
    expect(row).toBeDefined();
    expect((row as { id: string }).id).toBe(world.orgA.teamId);
  });

  it('org_B actor reads their own coach assignment via findFirst', async () => {
    const scoped = scopedDb(world.db as unknown as ScopedDbHandle, actorFor(world.orgB.id));
    const row = await scoped.coachAssignments.findFirst({
      where: eq(coachAssignments.id, 'ca_B'),
    });
    expect(row).toBeDefined();
    expect((row as { id: string }).id).toBe('ca_B');
  });
});

describe('scopedDb — crossTenant() escape hatch returns the un-scoped handle', () => {
  it('dev_admin sees both orgs through crossTenant()', async () => {
    const scoped = scopedDb(world.db as unknown as ScopedDbHandle, devAdminActor());
    const unscoped = scoped.crossTenant();
    // The un-scoped handle is the same Drizzle handle we passed in,
    // so a raw `db.query.organizations.findMany()` walks every row.
    const rows = await unscoped.query.organizations.findMany();
    const ids = (rows as Array<{ id: string }>).map((r) => r.id).sort();
    expect(ids).toEqual([world.orgA.id, world.orgB.id].sort());
  });

  it('non-dev_admin role cannot escape via crossTenant()', () => {
    const scoped = scopedDb(world.db as unknown as ScopedDbHandle, actorFor(world.orgA.id));
    expect(() => scoped.crossTenant()).toThrow(/Only dev_admin may bypass tenant scoping/);
  });
});

describe('scopedDb — cross-tenant writes are refused', () => {
  it('org_A actor cannot update an org_B team via the scoped surface', async () => {
    const scoped = scopedDb(world.db as unknown as ScopedDbHandle, actorFor(world.orgA.id));
    await scoped.update(teams).set({ name: 'Hijacked' }).where(eq(teams.id, world.orgB.teamId));
    // Re-read with a dev_admin to confirm the org_B team name was NOT
    // mutated by the org_A actor's scoped update.
    const devScoped = scopedDb(world.db as unknown as ScopedDbHandle, devAdminActor());
    const orgBTeam = await devScoped
      .crossTenant()
      .query.teams.findFirst({ where: eq(teams.id, world.orgB.teamId) });
    expect((orgBTeam as { name: string }).name).toBe('Team B1');
  });

  it('org_A actor cannot delete org_B coach assignments via the scoped surface', async () => {
    const scoped = scopedDb(world.db as unknown as ScopedDbHandle, actorFor(world.orgA.id));
    await scoped.delete(coachAssignments).where(eq(coachAssignments.id, 'ca_B'));
    const devScoped = scopedDb(world.db as unknown as ScopedDbHandle, devAdminActor());
    const orgBAssignment = await devScoped
      .crossTenant()
      .query.coachAssignments.findFirst({ where: eq(coachAssignments.id, 'ca_B') });
    expect(orgBAssignment).toBeDefined();
  });

  it('org_A actor inserting an org_B-stamped row throws before reaching the database', async () => {
    const scoped = scopedDb(world.db as unknown as ScopedDbHandle, actorFor(world.orgA.id));
    expect(() =>
      scoped
        .insert(teams)
        .values({ id: 'team_attack', orgId: world.orgB.id, name: 'Cross-Tenant Team' }),
    ).toThrow(/row\.orgId must equal actor\.orgId/);
    // Confirm the row was never persisted.
    const devScoped = scopedDb(world.db as unknown as ScopedDbHandle, devAdminActor());
    const attacker = await devScoped
      .crossTenant()
      .query.teams.findFirst({ where: eq(teams.id, 'team_attack') });
    expect(attacker).toBeUndefined();
  });
});
