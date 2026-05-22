/**
 * Contract test — athleteMemberships cross-org rejection (Story #617,
 * Task #628).
 *
 * Pins the load-bearing CHECK-trigger contract from migration 0002:
 * the `athlete_memberships` row's `org_id` MUST match both the team's
 * `org_id` and the athlete user's `org_id`. Asserts each leg of the
 * dual-FK invariant independently, plus the happy path so the test
 * also pins the positive contract.
 *
 * Mirrors the trigger definitions in
 * `packages/shared/src/db/migrations/0002_org_team_graph.sql`
 * (`athlete_memberships_cross_tenant_insert_check`). The matching
 * application-layer enforcement lives in `scopedDb(actor)` (Story #607);
 * see `db/queries/__tests__/scopedDbCrossTenant.contract.test.ts` for
 * the orthogonal in-code defense.
 */

import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { athleteMemberships } from '../athleteMemberships';
import { organizations } from '../organizations';
import { teams } from '../teams';
import { users } from '../users';
import { freshSchemaDb } from './freshSchemaDb';

interface TwoOrgWorld {
  db: ReturnType<typeof freshSchemaDb>;
  orgA: { id: string; teamId: string; athleteId: string };
  orgB: { id: string; teamId: string; athleteId: string };
}

async function seedTwoOrgWorld(): Promise<TwoOrgWorld> {
  const db = freshSchemaDb();
  const orgA = { id: 'org_A', teamId: 'team_A1', athleteId: 'u_A_athlete' };
  const orgB = { id: 'org_B', teamId: 'team_B1', athleteId: 'u_B_athlete' };

  await db.insert(organizations).values([
    { id: orgA.id, name: 'Org A', organizationType: 'HIGH_SCHOOL' },
    { id: orgB.id, name: 'Org B', organizationType: 'HIGH_SCHOOL' },
  ]);
  await db.insert(teams).values([
    { id: orgA.teamId, orgId: orgA.id, name: 'Team A1' },
    { id: orgB.teamId, orgId: orgB.id, name: 'Team B1' },
  ]);
  await db.insert(users).values([
    {
      id: orgA.athleteId,
      clerkSubjectId: 'clerk_A_athlete',
      email: 'athlete-a@example.invalid',
      role: 'member',
      orgId: orgA.id,
      teamId: orgA.teamId,
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
  return { db, orgA, orgB };
}

describe('athlete_memberships — cross-org rejection via CHECK trigger', () => {
  it('rejects when the row.orgId does not match the team.orgId', async () => {
    const { db, orgA, orgB } = await seedTwoOrgWorld();

    const insert = () =>
      db.insert(athleteMemberships).values({
        id: 'am_bad_team',
        orgId: orgA.id, // pretend org A
        teamId: orgB.teamId, // but pointing at org B's team
        athleteUserId: orgA.athleteId,
      });

    await expect(insert()).rejects.toThrow(
      /athlete_memberships\.org_id does not match teams\.org_id/,
    );
    const leaked = await db.query.athleteMemberships.findFirst({
      where: eq(athleteMemberships.id, 'am_bad_team'),
    });
    expect(leaked).toBeUndefined();
  });

  it('rejects when the row.orgId does not match the athlete user.orgId', async () => {
    const { db, orgA, orgB } = await seedTwoOrgWorld();

    const insert = () =>
      db.insert(athleteMemberships).values({
        id: 'am_bad_athlete',
        orgId: orgA.id, // pretend org A
        teamId: orgA.teamId,
        athleteUserId: orgB.athleteId, // but athlete belongs to org B
      });

    await expect(insert()).rejects.toThrow(
      /athlete_memberships\.org_id does not match users\.org_id/,
    );
    const leaked = await db.query.athleteMemberships.findFirst({
      where: eq(athleteMemberships.id, 'am_bad_athlete'),
    });
    expect(leaked).toBeUndefined();
  });
});

describe('athlete_memberships — single-org happy path', () => {
  it('accepts a row whose orgId matches both the team.orgId and the athlete.orgId', async () => {
    const { db, orgA } = await seedTwoOrgWorld();

    await db.insert(athleteMemberships).values({
      id: 'am_ok',
      orgId: orgA.id,
      teamId: orgA.teamId,
      athleteUserId: orgA.athleteId,
    });

    const row = await db.query.athleteMemberships.findFirst({
      where: eq(athleteMemberships.id, 'am_ok'),
    });
    expect(row).toBeDefined();
    expect(row?.orgId).toBe(orgA.id);
    expect(row?.teamId).toBe(orgA.teamId);
    expect(row?.athleteUserId).toBe(orgA.athleteId);
  });
});
