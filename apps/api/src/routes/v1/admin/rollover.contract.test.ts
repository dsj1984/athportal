// apps/api/src/routes/v1/admin/rollover.contract.test.ts
//
// Contract test for the season-rollover preview + commit endpoints
// (Epic #10 / Story #665 / Task #695). Pins the wire shape AND the
// load-bearing STALE_PLAN invariant for `/api/v1/admin/rollover/*`:
//
//   - POST /preview happy path returns the canonical plan envelope
//     and writes nothing to the DB
//   - POST /commit  happy path applies the plan inside one
//     transaction: source rows are end-dated, target rows are
//     inserted, the response carries the applied counts
//   - POST /commit  returns 409 STALE_PLAN when a row moves between
//     preview and commit (a membership ended out-of-band) — and no
//     writes happen
//   - INVALID_BODY  Zod boundary rejects bad payloads on both endpoints
//   - Cross-org isolation: an org_admin from org A cannot preview or
//     commit rollover against org B's memberships — the source-season
//     fetch is pinned to the actor's org, so the recomputed plan is
//     empty and the response carries no org-B rows.
//
// Composition: real `rolloverAdminRoute` mounted at
// `/api/v1/admin/rollover` against `createTestApp(db, { actor })`.
// The `requireRole('org_admin')` gate from `./index.ts` is NOT in the
// chain here — its behavior is covered by `./admin-router.contract.test.ts`.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { athleteMemberships, organizations, teams, users } from '@repo/shared/db/schema';
import { type AuthContext, createTestApp } from '@repo/shared/testing';
import Database from 'better-sqlite3';
import { and, eq, isNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';
import type { RequireInternalUserEnv } from '../../../middleware/auth';
import { rolloverAdminRoute } from './rollover';
import { rosterAdminRoute } from './roster';

const MIGRATIONS_DIR = join(__dirname, '../../../../../../packages/shared/src/db/migrations');

function freshRolloverDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  for (const file of [
    '0000_auth_and_rbac.sql',
    '0001_onboarding_schema.sql',
    '0002_org_team_graph.sql',
    '0003_invitations.sql',
    '0004_org_branding.sql',
    '0005_team_metadata.sql',
    // Story #1054 / F33 — nullable first_name/last_name on users.
    '0010_users_name.sql',
  ]) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    for (const stmt of sql.split('--> statement-breakpoint').map((s) => s.trim())) {
      if (stmt.length > 0) sqlite.exec(stmt);
    }
  }
  return drizzle(sqlite, {
    schema: { organizations, teams, users, athleteMemberships },
  });
}

type RolloverDb = ReturnType<typeof freshRolloverDb>;

const ORG_A = 'org_a_test';
const ORG_B = 'org_b_test';

function actor(orgId: string, overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: `u_admin_${orgId}`,
    clerkSubjectId: `user_test_${orgId}`,
    email: `admin-${orgId}@test.invalid`,
    role: 'org_admin',
    orgId,
    teamId: null,
    ...overrides,
  };
}

function seedOrg(db: RolloverDb, id: string): void {
  db.insert(organizations)
    .values({ id, name: `Org ${id}`, organizationType: 'CLUB' })
    .onConflictDoNothing()
    .run();
}

function seedTeam(
  db: RolloverDb,
  orgId: string,
  opts: { id?: string; name?: string; sport?: string; season?: string; ageGroup?: string } = {},
): string {
  const id = opts.id ?? `t_${orgId}_${Math.random().toString(36).slice(2, 8)}`;
  db.insert(teams)
    .values({
      id,
      orgId,
      name: opts.name ?? 'Default Team',
      sport: opts.sport ?? 'Volleyball',
      season: opts.season ?? 'Fall 2026',
      ageGroup: opts.ageGroup ?? 'U14',
    })
    .run();
  return id;
}

function seedAthleteUser(
  db: RolloverDb,
  orgId: string,
  opts: { id?: string; email?: string } = {},
): string {
  const id = opts.id ?? `u_${orgId}_${Math.random().toString(36).slice(2, 8)}`;
  db.insert(users)
    .values({
      id,
      clerkSubjectId: `clerk_${id}`,
      email: opts.email ?? `${id}@test.invalid`,
      role: 'member',
      orgId,
      teamId: null,
    })
    .run();
  return id;
}

function seedMembership(
  db: RolloverDb,
  orgId: string,
  teamId: string,
  athleteUserId: string,
  opts: { id?: string; endedAt?: Date | null } = {},
): string {
  const id = opts.id ?? `am_${orgId}_${Math.random().toString(36).slice(2, 8)}`;
  db.insert(athleteMemberships)
    .values({ id, orgId, teamId, athleteUserId, endedAt: opts.endedAt ?? null })
    .run();
  return id;
}

function buildApp(db: RolloverDb, a: AuthContext) {
  const harness = createTestApp(db, { actor: a }) as unknown as Hono<RequireInternalUserEnv>;
  harness.route('/api/v1/admin/rollover', rolloverAdminRoute);
  return harness;
}

const STUB_ENV = { ANALYTICS: { writeDataPoint: () => undefined } };

interface PlanShape {
  archives: Array<{
    membershipId: string;
    athleteUserId: string;
    sourceTeamId: string;
    reason: string;
  }>;
  promotions: Array<{
    athleteUserId: string;
    orgId: string;
    sourceTeamId: string;
    targetTeamId: string;
    reason: string;
  }>;
  errors: Array<{ membershipId: string; code: string }>;
}

interface PreviewBody {
  success: boolean;
  data: { plan: PlanShape };
}

interface CommitBody {
  success: boolean;
  data: {
    applied: { archived: number; promoted: number; errors: number };
    plan: PlanShape;
  };
}

interface ErrorBody {
  success: false;
  error: { code: string; message: string };
}

beforeEach(() => {
  // No-op — each test builds its own DB instance via `freshRolloverDb()`.
});

describe('POST /api/v1/admin/rollover/preview', () => {
  it('returns the planned writes with the canonical envelope and writes nothing', async () => {
    const db = freshRolloverDb();
    seedOrg(db, ORG_A);
    const teamU14 = seedTeam(db, ORG_A, { name: 'U14', season: 'Fall 2026', ageGroup: 'U14' });
    const teamU15 = seedTeam(db, ORG_A, { name: 'U15', season: 'Fall 2027', ageGroup: 'U15' });
    const ada = seedAthleteUser(db, ORG_A, { id: 'u_ada' });
    const grace = seedAthleteUser(db, ORG_A, { id: 'u_grace' });
    const memAda = seedMembership(db, ORG_A, teamU14, ada, { id: 'am_ada' });
    const memGrace = seedMembership(db, ORG_A, teamU14, grace, { id: 'am_grace' });

    const res = await buildApp(db, actor(ORG_A)).request(
      '/api/v1/admin/rollover/preview',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sourceSeason: 'Fall 2026',
          targetSeason: 'Fall 2027',
          choices: [
            { membershipId: memAda, decision: 'promote', targetTeamId: teamU15 },
            { membershipId: memGrace, decision: 'archive' },
          ],
        }),
      },
      STUB_ENV,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as PreviewBody;
    expect(body.success).toBe(true);
    expect(body.data.plan.archives).toHaveLength(2);
    expect(body.data.plan.promotions).toHaveLength(1);
    expect(body.data.plan.errors).toHaveLength(0);
    expect(body.data.plan.promotions[0]?.targetTeamId).toBe(teamU15);

    // DB side-effect: no rows were end-dated, no new rows inserted.
    const activeAfter = await db
      .select()
      .from(athleteMemberships)
      .where(isNull(athleteMemberships.endedAt));
    expect(activeAfter).toHaveLength(2); // both originals still active
  });

  it('returns 400 INVALID_BODY when the payload is malformed', async () => {
    const db = freshRolloverDb();
    seedOrg(db, ORG_A);

    const res = await buildApp(db, actor(ORG_A)).request(
      '/api/v1/admin/rollover/preview',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sourceSeason: '', targetSeason: 'Fall 2027', choices: [] }),
      },
      STUB_ENV,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorBody;
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INVALID_BODY');
  });
});

describe('POST /api/v1/admin/rollover/commit', () => {
  it('applies the plan transactionally and returns the applied counts', async () => {
    const db = freshRolloverDb();
    seedOrg(db, ORG_A);
    const teamU14 = seedTeam(db, ORG_A, { name: 'U14', season: 'Fall 2026', ageGroup: 'U14' });
    const teamU15 = seedTeam(db, ORG_A, { name: 'U15', season: 'Fall 2027', ageGroup: 'U15' });
    const ada = seedAthleteUser(db, ORG_A, { id: 'u_ada' });
    const grace = seedAthleteUser(db, ORG_A, { id: 'u_grace' });
    const memAda = seedMembership(db, ORG_A, teamU14, ada, { id: 'am_ada' });
    const memGrace = seedMembership(db, ORG_A, teamU14, grace, { id: 'am_grace' });

    // Step 1: preview to get the canonical plan.
    const app = buildApp(db, actor(ORG_A));
    const previewRes = await app.request(
      '/api/v1/admin/rollover/preview',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sourceSeason: 'Fall 2026',
          targetSeason: 'Fall 2027',
          choices: [
            { membershipId: memAda, decision: 'promote', targetTeamId: teamU15 },
            { membershipId: memGrace, decision: 'archive' },
          ],
        }),
      },
      STUB_ENV,
    );
    const previewBody = (await previewRes.json()) as PreviewBody;
    const expectedPlan = previewBody.data.plan;

    // Step 2: commit with the preview plan as expectedPlan.
    const commitRes = await app.request(
      '/api/v1/admin/rollover/commit',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sourceSeason: 'Fall 2026',
          targetSeason: 'Fall 2027',
          choices: [
            { membershipId: memAda, decision: 'promote', targetTeamId: teamU15 },
            { membershipId: memGrace, decision: 'archive' },
          ],
          expectedPlan,
        }),
      },
      STUB_ENV,
    );
    expect(commitRes.status).toBe(200);
    const commitBody = (await commitRes.json()) as CommitBody;
    expect(commitBody.success).toBe(true);
    expect(commitBody.data.applied.archived).toBe(2);
    expect(commitBody.data.applied.promoted).toBe(1);
    expect(commitBody.data.applied.errors).toBe(0);

    // DB side-effect: both source memberships are end-dated.
    const adaSource = await db
      .select()
      .from(athleteMemberships)
      .where(eq(athleteMemberships.id, memAda));
    expect((adaSource[0] as { endedAt: Date | null }).endedAt).not.toBeNull();
    const graceSource = await db
      .select()
      .from(athleteMemberships)
      .where(eq(athleteMemberships.id, memGrace));
    expect((graceSource[0] as { endedAt: Date | null }).endedAt).not.toBeNull();
    // And a new membership row exists on the target team for Ada.
    const newU15 = await db
      .select()
      .from(athleteMemberships)
      .where(
        and(
          eq(athleteMemberships.teamId, teamU15),
          eq(athleteMemberships.athleteUserId, ada),
          isNull(athleteMemberships.endedAt),
        ),
      );
    expect(newU15).toHaveLength(1);
  });

  it('returns 409 STALE_PLAN when a membership moves between preview and commit', async () => {
    const db = freshRolloverDb();
    seedOrg(db, ORG_A);
    const teamU14 = seedTeam(db, ORG_A, { name: 'U14', season: 'Fall 2026', ageGroup: 'U14' });
    const teamU15 = seedTeam(db, ORG_A, { name: 'U15', season: 'Fall 2027', ageGroup: 'U15' });
    const ada = seedAthleteUser(db, ORG_A, { id: 'u_ada' });
    const grace = seedAthleteUser(db, ORG_A, { id: 'u_grace' });
    const memAda = seedMembership(db, ORG_A, teamU14, ada, { id: 'am_ada' });
    const memGrace = seedMembership(db, ORG_A, teamU14, grace, { id: 'am_grace' });

    const app = buildApp(db, actor(ORG_A));
    // Preview with both athletes in the source season.
    const previewRes = await app.request(
      '/api/v1/admin/rollover/preview',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sourceSeason: 'Fall 2026',
          targetSeason: 'Fall 2027',
          choices: [
            { membershipId: memAda, decision: 'promote', targetTeamId: teamU15 },
            { membershipId: memGrace, decision: 'archive' },
          ],
        }),
      },
      STUB_ENV,
    );
    const expectedPlan = ((await previewRes.json()) as PreviewBody).data.plan;

    // Out-of-band: grace's membership is end-dated by another admin
    // before the commit lands. The recomputed plan no longer includes
    // grace, so the equality check fails and the commit refuses.
    db.update(athleteMemberships)
      .set({ endedAt: new Date('2026-10-01T00:00:00Z') })
      .where(eq(athleteMemberships.id, memGrace))
      .run();

    const commitRes = await app.request(
      '/api/v1/admin/rollover/commit',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sourceSeason: 'Fall 2026',
          targetSeason: 'Fall 2027',
          choices: [
            { membershipId: memAda, decision: 'promote', targetTeamId: teamU15 },
            { membershipId: memGrace, decision: 'archive' },
          ],
          expectedPlan,
        }),
      },
      STUB_ENV,
    );
    expect(commitRes.status).toBe(409);
    const errBody = (await commitRes.json()) as ErrorBody;
    expect(errBody.success).toBe(false);
    expect(errBody.error.code).toBe('STALE_PLAN');

    // Defence in depth: no new target-team row was inserted, ada's
    // source row was NOT end-dated (the whole commit aborted).
    const adaSource = await db
      .select()
      .from(athleteMemberships)
      .where(eq(athleteMemberships.id, memAda));
    expect((adaSource[0] as { endedAt: Date | null }).endedAt).toBeNull();
    const newU15 = await db
      .select()
      .from(athleteMemberships)
      .where(
        and(eq(athleteMemberships.teamId, teamU15), eq(athleteMemberships.athleteUserId, ada)),
      );
    expect(newU15).toHaveLength(0);
  });

  it('returns 400 INVALID_BODY when the commit payload omits expectedPlan', async () => {
    const db = freshRolloverDb();
    seedOrg(db, ORG_A);

    const res = await buildApp(db, actor(ORG_A)).request(
      '/api/v1/admin/rollover/commit',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sourceSeason: 'Fall 2026',
          targetSeason: 'Fall 2027',
          choices: [],
        }),
      },
      STUB_ENV,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('INVALID_BODY');
  });
});

describe('Cross-org isolation', () => {
  it('returns an empty plan when an org A admin previews against org B memberships', async () => {
    const db = freshRolloverDb();
    seedOrg(db, ORG_A);
    seedOrg(db, ORG_B);
    // Org B has the rollover universe; org A has nothing.
    const teamB = seedTeam(db, ORG_B, { name: 'B-U14', season: 'Fall 2026' });
    const athleteB = seedAthleteUser(db, ORG_B, { id: 'u_b_ada' });
    const memB = seedMembership(db, ORG_B, teamB, athleteB, { id: 'am_b_ada' });

    // Actor is an org_admin in ORG_A. They submit a choice keyed to
    // an ORG_B membership id — the server-side fetch is scoped to ORG_A,
    // so the membership is unknown to the builder. The plan reports
    // UNKNOWN_MEMBERSHIP, NOT a successful archive of an org-B row.
    const res = await buildApp(db, actor(ORG_A)).request(
      '/api/v1/admin/rollover/preview',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sourceSeason: 'Fall 2026',
          targetSeason: 'Fall 2027',
          choices: [{ membershipId: memB, decision: 'archive' }],
        }),
      },
      STUB_ENV,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as PreviewBody;
    expect(body.data.plan.archives).toHaveLength(0);
    expect(body.data.plan.promotions).toHaveLength(0);
    expect(body.data.plan.errors).toHaveLength(1);
    expect(body.data.plan.errors[0]?.code).toBe('UNKNOWN_MEMBERSHIP');

    // DB side-effect: ORG_B's membership is untouched.
    const stillActive = await db
      .select()
      .from(athleteMemberships)
      .where(and(eq(athleteMemberships.id, memB), isNull(athleteMemberships.endedAt)));
    expect(stillActive).toHaveLength(1);
  });

  it('a commit issued by an org A admin against an org B membership id refuses (UNKNOWN row → empty applied plan)', async () => {
    const db = freshRolloverDb();
    seedOrg(db, ORG_A);
    seedOrg(db, ORG_B);
    const teamB = seedTeam(db, ORG_B, { name: 'B-U14', season: 'Fall 2026' });
    const athleteB = seedAthleteUser(db, ORG_B, { id: 'u_b_ada' });
    const memB = seedMembership(db, ORG_B, teamB, athleteB, { id: 'am_b_ada' });

    // The preview that org A would have run reports UNKNOWN_MEMBERSHIP.
    // The expectedPlan they'd carry forward is empty-archives /
    // empty-promotions / one-error. Commit must match that exact plan
    // and apply zero writes against the org-B row.
    const app = buildApp(db, actor(ORG_A));
    const previewRes = await app.request(
      '/api/v1/admin/rollover/preview',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sourceSeason: 'Fall 2026',
          targetSeason: 'Fall 2027',
          choices: [{ membershipId: memB, decision: 'archive' }],
        }),
      },
      STUB_ENV,
    );
    const expectedPlan = ((await previewRes.json()) as PreviewBody).data.plan;

    const commitRes = await app.request(
      '/api/v1/admin/rollover/commit',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sourceSeason: 'Fall 2026',
          targetSeason: 'Fall 2027',
          choices: [{ membershipId: memB, decision: 'archive' }],
          expectedPlan,
        }),
      },
      STUB_ENV,
    );

    expect(commitRes.status).toBe(200);
    const commitBody = (await commitRes.json()) as CommitBody;
    expect(commitBody.data.applied.archived).toBe(0);
    expect(commitBody.data.applied.promoted).toBe(0);
    expect(commitBody.data.applied.errors).toBe(1);

    // Org-B membership untouched.
    const stillActive = await db
      .select()
      .from(athleteMemberships)
      .where(and(eq(athleteMemberships.id, memB), isNull(athleteMemberships.endedAt)));
    expect(stillActive).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Story #972 — roster ↔ rollover ID-shape contract
// ─────────────────────────────────────────────────────────────────────
//
// Regression pin for the silently-broken rollover surface uncovered in
// Story #945 Session 3. Before #972, the `/admin/rollover` form
// synthesized membership keys from `athleteId` (because the roster
// projection did not surface `membershipId`); the planner then rejected
// every row with `UNKNOWN_MEMBERSHIP` and the operator saw "Applied —
// archived: 0, promoted: 0, errors: N" against a no-op commit.
//
// This contract test wires the real roster handler and the real
// rollover handlers against one shared in-memory DB, then drives the
// end-to-end shape the form uses post-#972:
//
//   1. GET  /api/v1/admin/roster                — read the projection
//   2. POST /api/v1/admin/rollover/preview      — using membershipId
//                                                 from step 1
//   3. POST /api/v1/admin/rollover/commit       — using the preview's
//                                                 expectedPlan
//
// The pre-#972 form's synthesized-from-athleteId key would have failed
// this scenario at step 2 (`errors: 1` per row). Post-#972, the roster
// projection includes the real membership id and the rollover surface
// reports `errors: 0` and applies the writes.

describe('roster → rollover ID-shape end-to-end (Story #972 F1, F4)', () => {
  function buildRosterAndRolloverApp(db: RolloverDb, a: AuthContext) {
    const harness = createTestApp(db, { actor: a }) as unknown as Hono<RequireInternalUserEnv>;
    harness.route('/api/v1/admin/roster', rosterAdminRoute);
    harness.route('/api/v1/admin/rollover', rolloverAdminRoute);
    return harness;
  }

  it('surfaces membershipId in the roster projection so the rollover planner accepts it', async () => {
    const db = freshRolloverDb();
    seedOrg(db, ORG_A);
    const teamU14 = seedTeam(db, ORG_A, { name: 'U14', season: 'Fall 2026', ageGroup: 'U14' });
    const ada = seedAthleteUser(db, ORG_A, { id: 'u_ada', email: 'ada@test.invalid' });
    const memAda = seedMembership(db, ORG_A, teamU14, ada, { id: 'am_ada' });

    const app = buildRosterAndRolloverApp(db, actor(ORG_A));

    // Step 1: roster projection MUST carry membershipId. Pre-#972 this
    // field did not exist and the form synthesized one from athleteId.
    const rosterRes = await app.request('/api/v1/admin/roster', { method: 'GET' }, STUB_ENV);
    expect(rosterRes.status).toBe(200);
    const rosterBody = (await rosterRes.json()) as {
      data: { items: Array<{ membershipId: string; athleteId: string; teamId: string }> };
    };
    expect(rosterBody.data.items[0]?.membershipId).toBe(memAda);
    expect(rosterBody.data.items[0]?.athleteId).toBe(ada);
    // Pre-#972 invariant violation reproducer: when the form sent the
    // user id where the planner expected the membership id, the planner
    // emitted UNKNOWN_MEMBERSHIP — confirm that legacy shape still
    // fails so a regression can be caught quickly.
    const previewWithUserId = await app.request(
      '/api/v1/admin/rollover/preview',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sourceSeason: 'Fall 2026',
          targetSeason: 'Fall 2027',
          choices: [{ membershipId: ada, decision: 'promote', targetTeamId: teamU14 }],
        }),
      },
      STUB_ENV,
    );
    const legacyBody = (await previewWithUserId.json()) as PreviewBody;
    expect(legacyBody.data.plan.errors).toHaveLength(1);
    expect(legacyBody.data.plan.errors[0]?.code).toBe('UNKNOWN_MEMBERSHIP');
  });

  it('roster→preview→commit using membershipId from the projection applies writes with errors: 0', async () => {
    const db = freshRolloverDb();
    seedOrg(db, ORG_A);
    const teamU14 = seedTeam(db, ORG_A, { name: 'U14', season: 'Fall 2026', ageGroup: 'U14' });
    const ada = seedAthleteUser(db, ORG_A, { id: 'u_ada', email: 'ada@test.invalid' });
    const grace = seedAthleteUser(db, ORG_A, { id: 'u_grace', email: 'grace@test.invalid' });
    const memAda = seedMembership(db, ORG_A, teamU14, ada, { id: 'am_ada' });
    const memGrace = seedMembership(db, ORG_A, teamU14, grace, { id: 'am_grace' });

    const app = buildRosterAndRolloverApp(db, actor(ORG_A));

    // Step 1: load roster (the form's "Load roster" pass).
    const rosterRes = await app.request('/api/v1/admin/roster', { method: 'GET' }, STUB_ENV);
    const rosterBody = (await rosterRes.json()) as {
      data: { items: Array<{ membershipId: string; teamId: string }> };
    };
    expect(rosterBody.data.items).toHaveLength(2);

    // Step 2: build the choices payload the post-#972 form sends —
    // membershipId comes straight from the roster projection, and
    // promote auto-fills targetTeamId with sourceTeamId (F3).
    const choices = rosterBody.data.items.map((item) => ({
      membershipId: item.membershipId,
      decision: 'promote' as const,
      targetTeamId: item.teamId,
    }));

    const previewRes = await app.request(
      '/api/v1/admin/rollover/preview',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sourceSeason: 'Fall 2026',
          targetSeason: 'Fall 2027',
          choices,
        }),
      },
      STUB_ENV,
    );
    expect(previewRes.status).toBe(200);
    const previewBody = (await previewRes.json()) as PreviewBody;
    // The load-bearing assertion — Story #972 fixes the form's shape
    // so this is 0, not the pre-fix `errors: 2`.
    expect(previewBody.data.plan.errors).toHaveLength(0);
    expect(previewBody.data.plan.archives).toHaveLength(2);
    expect(previewBody.data.plan.promotions).toHaveLength(2);

    // Step 3: commit with the canonical expectedPlan.
    const commitRes = await app.request(
      '/api/v1/admin/rollover/commit',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sourceSeason: 'Fall 2026',
          targetSeason: 'Fall 2027',
          choices,
          expectedPlan: previewBody.data.plan,
        }),
      },
      STUB_ENV,
    );
    expect(commitRes.status).toBe(200);
    const commitBody = (await commitRes.json()) as CommitBody;
    expect(commitBody.data.applied.errors).toBe(0);
    expect(commitBody.data.applied.archived).toBe(2);
    expect(commitBody.data.applied.promoted).toBe(2);

    // DB side-effect: both source rows end-dated, two new rows active.
    const adaSource = await db
      .select()
      .from(athleteMemberships)
      .where(eq(athleteMemberships.id, memAda));
    expect((adaSource[0] as { endedAt: Date | null }).endedAt).not.toBeNull();
    const graceSource = await db
      .select()
      .from(athleteMemberships)
      .where(eq(athleteMemberships.id, memGrace));
    expect((graceSource[0] as { endedAt: Date | null }).endedAt).not.toBeNull();
    const activeAfter = await db
      .select()
      .from(athleteMemberships)
      .where(isNull(athleteMemberships.endedAt));
    expect(activeAfter).toHaveLength(2);
  });
});
