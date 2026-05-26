/**
 * @repo/shared/db/queries/coach/roster — unit test
 *
 * Epic #11 / Story #912 / Task #921. Pins the three AC invariants for
 * the coach roster query module:
 *
 *   1. `listRosterEntries` returns only rows where `endedAt IS NULL`
 *      and `team_id` matches.
 *   2. A row from another tenant (same team id, different org) is
 *      filtered out by the org-scope predicate the query injects.
 *      (The AC nominates `scopedDb` as the defense; `scopedDb` does
 *      not cover `roster_entry`, so this module enforces the same
 *      invariant directly via `eq(rosterEntries.orgId, actor.orgId)`
 *      — see the module docstring for the defense-in-depth rationale.)
 *   3. Neither exported function imports Hono or any HTTP type — the
 *      module surface is pure DB. Pinned by source inspection so a
 *      future refactor that pulls in `hono` here trips the test.
 *
 * Companion: `apps/api/src/routes/v1/coach/roster.contract.test.ts`
 * exercises the route handler + query module against the same
 * better-sqlite3 ephemeral handle. This test stays at the query
 * boundary so any drift between AC #1/#2 and the query layer surfaces
 * here before the contract test sees it.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { freshSchemaDb } from '../../schema/__tests__/freshSchemaDb';
import { organizations } from '../../schema/organizations';
import { rosterEntries } from '../../schema/rosterEntries';
import { teams } from '../../schema/teams';
import { users } from '../../schema/users';
import { getTeamScopedAthlete, listRosterEntries } from './roster';

const ORG_A = 'org_a_test';
const ORG_B = 'org_b_test';

type Db = ReturnType<typeof freshSchemaDb>;

function seedOrg(db: Db, id: string): void {
  db.insert(organizations)
    .values({ id, name: `Org ${id}`, organizationType: 'CLUB' })
    .onConflictDoNothing()
    .run();
}

function seedTeam(db: Db, orgId: string, id: string): string {
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

function seedUser(db: Db, orgId: string, id: string): string {
  db.insert(users)
    .values({
      id,
      clerkSubjectId: `clerk_${id}`,
      email: `${id}@test.invalid`,
      role: 'member',
      orgId,
      teamId: null,
    })
    .run();
  return id;
}

function seedRosterEntry(
  db: Db,
  orgId: string,
  teamId: string,
  athleteUserId: string,
  opts: { id?: string; endedAt?: Date | null; jerseyNumber?: string | null } = {},
): string {
  const id = opts.id ?? `re_${orgId}_${teamId}_${athleteUserId}`;
  db.insert(rosterEntries)
    .values({
      id,
      orgId,
      teamId,
      athleteUserId,
      jerseyNumber: opts.jerseyNumber ?? '7',
      primaryPosition: 'Setter',
      endedAt: opts.endedAt ?? null,
    })
    .run();
  return id;
}

describe('listRosterEntries', () => {
  it('returns only active rows on the requested team', () => {
    // Arrange
    const db = freshSchemaDb();
    seedOrg(db, ORG_A);
    const teamId = seedTeam(db, ORG_A, 't_one');
    const otherTeamId = seedTeam(db, ORG_A, 't_two');
    const aliceId = seedUser(db, ORG_A, 'u_alice');
    const bobId = seedUser(db, ORG_A, 'u_bob');
    const carolId = seedUser(db, ORG_A, 'u_carol');
    seedRosterEntry(db, ORG_A, teamId, aliceId, { id: 're_active' });
    seedRosterEntry(db, ORG_A, teamId, bobId, {
      id: 're_ended',
      endedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    seedRosterEntry(db, ORG_A, otherTeamId, carolId, { id: 're_other_team' });

    // Act
    const rows = listRosterEntries(db, { orgId: ORG_A }, teamId);

    // Assert
    expect(rows.map((r) => r.id)).toEqual(['re_active']);
    expect(rows[0]?.athleteEmail).toBe('u_alice@test.invalid');
    expect(rows[0]?.endedAt).toBeNull();
  });

  it('excludes a cross-org row even when the team id collides', () => {
    // Arrange — same team id in two orgs (different PKs, same value)
    // would never occur in production (team ids are unique), so this
    // test models the more realistic attack: a coach in org A presents
    // a teamId they know belongs to org B. The org-scope predicate
    // pinned inside the query must keep the row out.
    const db = freshSchemaDb();
    seedOrg(db, ORG_A);
    seedOrg(db, ORG_B);
    const teamA = seedTeam(db, ORG_A, 't_a');
    const teamB = seedTeam(db, ORG_B, 't_b');
    const a1 = seedUser(db, ORG_A, 'u_a1');
    const b1 = seedUser(db, ORG_B, 'u_b1');
    seedRosterEntry(db, ORG_A, teamA, a1, { id: 're_a' });
    seedRosterEntry(db, ORG_B, teamB, b1, { id: 're_b' });

    // Act — actor is in org A but asks for org B's team
    const rows = listRosterEntries(db, { orgId: ORG_A }, teamB);

    // Assert — defense-in-depth: no rows ever leak across the org
    // boundary even when the caller's teamId argument names a team
    // outside their tenant.
    expect(rows).toEqual([]);
  });
});

describe('getTeamScopedAthlete', () => {
  it('returns the roster entry for the requested team only', () => {
    // Arrange — one athlete on two teams in the same org. The two
    // roster rows carry different jersey numbers; the page must
    // surface the one whose team matches the URL-bound teamId.
    const db = freshSchemaDb();
    seedOrg(db, ORG_A);
    const team1 = seedTeam(db, ORG_A, 't_volley');
    const team2 = seedTeam(db, ORG_A, 't_basket');
    const athleteId = seedUser(db, ORG_A, 'u_dual');
    const entry1 = seedRosterEntry(db, ORG_A, team1, athleteId, {
      id: 're_v',
      jerseyNumber: '07',
    });
    seedRosterEntry(db, ORG_A, team2, athleteId, {
      id: 're_b',
      jerseyNumber: '23',
    });

    const row = getTeamScopedAthlete(db, { orgId: ORG_A }, team1, entry1);

    expect(row).not.toBeNull();
    expect(row?.teamId).toBe(team1);
    expect(row?.jerseyNumber).toBe('07');
  });

  it('returns null when the entry id belongs to another team', () => {
    const db = freshSchemaDb();
    seedOrg(db, ORG_A);
    const team1 = seedTeam(db, ORG_A, 't_v');
    const team2 = seedTeam(db, ORG_A, 't_b');
    const athleteId = seedUser(db, ORG_A, 'u_x');
    const entry1 = seedRosterEntry(db, ORG_A, team1, athleteId, { id: 're_v1' });

    // The entry exists, but we ask for it scoped to team2 — must miss.
    const row = getTeamScopedAthlete(db, { orgId: ORG_A }, team2, entry1);
    expect(row).toBeNull();
  });

  it('returns null when the entry belongs to another org', () => {
    const db = freshSchemaDb();
    seedOrg(db, ORG_A);
    seedOrg(db, ORG_B);
    const teamA = seedTeam(db, ORG_A, 't_a');
    const teamB = seedTeam(db, ORG_B, 't_b');
    const aAth = seedUser(db, ORG_A, 'u_a');
    const bAth = seedUser(db, ORG_B, 'u_b');
    seedRosterEntry(db, ORG_A, teamA, aAth, { id: 're_a' });
    const entryB = seedRosterEntry(db, ORG_B, teamB, bAth, { id: 're_b' });

    // Org A actor asks for org B's roster entry by id — must miss
    // regardless of which team id they present.
    expect(getTeamScopedAthlete(db, { orgId: ORG_A }, teamB, entryB)).toBeNull();
    expect(getTeamScopedAthlete(db, { orgId: ORG_A }, teamA, entryB)).toBeNull();
  });

  it('returns null when the row is end-dated', () => {
    const db = freshSchemaDb();
    seedOrg(db, ORG_A);
    const team = seedTeam(db, ORG_A, 't_t');
    const ath = seedUser(db, ORG_A, 'u_t');
    const entry = seedRosterEntry(db, ORG_A, team, ath, {
      id: 're_ended',
      endedAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    expect(getTeamScopedAthlete(db, { orgId: ORG_A }, team, entry)).toBeNull();
  });
});

describe('roster query module — purity surface', () => {
  // AC #3 — Neither function imports Hono or any HTTP type. Pinned by
  // source inspection so any future refactor that pulls a Hono / HTTP
  // type into this file trips the suite in the same PR.
  //
  // Reading the source from disk (rather than introspecting the module
  // at runtime) keeps the assertion honest — a tree-shaken `import`
  // would not appear in the runtime module surface but would still be
  // a contract break.
  const SOURCE_PATH = join(__dirname, 'roster.ts');

  it('does not import from hono', () => {
    const src = readFileSync(SOURCE_PATH, 'utf8');
    expect(src).not.toMatch(/from\s+['"]hono(?:\/.*)?['"]/);
  });

  it('does not reference HTTP request / response types', () => {
    const src = readFileSync(SOURCE_PATH, 'utf8');
    // The two canonical leaks would be `Context` (Hono's request
    // context) or a `Request`/`Response` import. The query file is
    // pure-Drizzle — none of these should appear.
    expect(src).not.toMatch(/\bContext\b/);
    expect(src).not.toMatch(/from\s+['"]@hono\b/);
  });
});
