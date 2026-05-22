/**
 * Contract test — coachAssignments cross-org rejection (Story #617,
 * Task #626).
 *
 * Pins the load-bearing CHECK-trigger contract from migration 0002:
 * the `coach_assignments` row's `org_id` MUST match both the team's
 * `org_id` and the coach user's `org_id`. Asserts each leg of the
 * dual-FK invariant independently, plus the happy path so the test
 * also pins the positive contract.
 *
 * Mirrors the trigger definitions in
 * `packages/shared/src/db/migrations/0002_org_team_graph.sql`
 * (`coach_assignments_cross_tenant_insert_check`). The matching
 * application-layer enforcement lives in `scopedDb(actor)` (Story #607);
 * see `db/queries/__tests__/scopedDbCrossTenant.contract.test.ts` for
 * the orthogonal in-code defense.
 */

import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { coachAssignments } from '../coachAssignments';
import { organizations } from '../organizations';
import { teams } from '../teams';
import { users } from '../users';
import { freshSchemaDb } from './freshSchemaDb';

interface TwoOrgWorld {
  db: ReturnType<typeof freshSchemaDb>;
  orgA: { id: string; teamId: string; coachId: string };
  orgB: { id: string; teamId: string; coachId: string };
}

async function seedTwoOrgWorld(): Promise<TwoOrgWorld> {
  const db = freshSchemaDb();
  const orgA = { id: 'org_A', teamId: 'team_A1', coachId: 'u_A_coach' };
  const orgB = { id: 'org_B', teamId: 'team_B1', coachId: 'u_B_coach' };

  await db.insert(organizations).values([
    { id: orgA.id, name: 'Org A', organizationType: 'CLUB' },
    { id: orgB.id, name: 'Org B', organizationType: 'CLUB' },
  ]);
  await db.insert(teams).values([
    { id: orgA.teamId, orgId: orgA.id, name: 'Team A1' },
    { id: orgB.teamId, orgId: orgB.id, name: 'Team B1' },
  ]);
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
      id: orgB.coachId,
      clerkSubjectId: 'clerk_B_coach',
      email: 'coach-b@example.invalid',
      role: 'team_admin',
      orgId: orgB.id,
      teamId: orgB.teamId,
    },
  ]);
  return { db, orgA, orgB };
}

describe('coach_assignments — cross-org rejection via CHECK trigger', () => {
  it('rejects when the row.orgId does not match the team.orgId', async () => {
    const { db, orgA, orgB } = await seedTwoOrgWorld();

    const insert = () =>
      db.insert(coachAssignments).values({
        id: 'ca_bad_team',
        orgId: orgA.id, // pretend org A
        teamId: orgB.teamId, // but pointing at org B's team
        coachUserId: orgA.coachId,
      });

    await expect(insert()).rejects.toThrow(
      /coach_assignments\.org_id does not match teams\.org_id/,
    );
    const leaked = await db.query.coachAssignments.findFirst({
      where: eq(coachAssignments.id, 'ca_bad_team'),
    });
    expect(leaked).toBeUndefined();
  });

  it('rejects when the row.orgId does not match the coach user.orgId', async () => {
    const { db, orgA, orgB } = await seedTwoOrgWorld();

    const insert = () =>
      db.insert(coachAssignments).values({
        id: 'ca_bad_coach',
        orgId: orgA.id, // pretend org A
        teamId: orgA.teamId,
        coachUserId: orgB.coachId, // but coach belongs to org B
      });

    await expect(insert()).rejects.toThrow(
      /coach_assignments\.org_id does not match users\.org_id/,
    );
    const leaked = await db.query.coachAssignments.findFirst({
      where: eq(coachAssignments.id, 'ca_bad_coach'),
    });
    expect(leaked).toBeUndefined();
  });
});

describe('coach_assignments — single-org happy path', () => {
  it('accepts a row whose orgId matches both the team.orgId and the coach.orgId', async () => {
    const { db, orgA } = await seedTwoOrgWorld();

    await db.insert(coachAssignments).values({
      id: 'ca_ok',
      orgId: orgA.id,
      teamId: orgA.teamId,
      coachUserId: orgA.coachId,
    });

    const row = await db.query.coachAssignments.findFirst({
      where: eq(coachAssignments.id, 'ca_ok'),
    });
    expect(row).toBeDefined();
    expect(row?.orgId).toBe(orgA.id);
    expect(row?.teamId).toBe(orgA.teamId);
    expect(row?.coachUserId).toBe(orgA.coachId);
  });
});
