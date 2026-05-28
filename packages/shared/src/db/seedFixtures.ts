/**
 * @repo/shared/db/seedFixtures — persona-graph seed for the QA-corpus
 * agent runner.
 *
 * Introduced by Epic #869 / Story #875 / Task #887. Tech Spec #871.
 *
 * The QA-corpus agent runner (and any operator running plans locally)
 * needs the canonical persona ↔ org ↔ team graph present in the local
 * SQLite DB before `/admin/*` plans can sign in and act. This seed
 * inserts the three synthetic persona users (`athlete@example.com`,
 * `coach@example.com`, `org-admin@example.com`) with `onboarded_at`
 * pinned to `SEED_BOOTSTRAP_EFFECTIVE_AT`, plus the org/team/membership/
 * roster graph they belong to. Story #986 grew the graph to two orgs,
 * three teams, and extra athletes so the multi-athlete (F31) and
 * multi-team / multi-org (F36) coach QA Plans run against a clean reset
 * without manual DB setup. Every insert uses Drizzle's
 * `onConflictDoNothing` on the table primary key for idempotence — the
 * same pattern `seedLegalDocuments` uses.
 *
 * Persona ↔ org ↔ team mapping is sourced from `PERSONA_FIXTURES` in
 * `@repo/shared/testing/auth` so the persona ↔ identifier ↔ role
 * mapping stays single-source. The `clerk_subject_id` values written
 * here are deterministic `user_test_*` stubs used by the contract-tier
 * middleware test surface. The operator's runtime DB does NOT use this
 * function — `pnpm db:seed` goes through
 * `packages/shared/scripts/seed.mjs`, which reads
 * `packages/shared/src/testing/clerk-personas.json` at seed time and
 * writes the operator's real `user_*` Clerk subject IDs (Story #942).
 *
 * The `dev_admin` persona is intentionally OUT OF SCOPE — see
 * Tech Spec #871 § Data Models. The operator's dev-admin Clerk identity
 * is provisioned per-developer via `scripts/seed-dev-admin.mjs`.
 *
 * Idempotence — calling `seedFixtures(db)` twice against the same
 * handle produces no duplicate rows (asserted by the unit test).
 */

import { athleteMemberships } from './schema/athleteMemberships';
import { coachAssignments } from './schema/coachAssignments';
import { organizations } from './schema/organizations';
import { rosterEntries } from './schema/rosterEntries';
import { teams } from './schema/teams';
import { users } from './schema/users';

/**
 * The bootstrap `effective_at` timestamp for the persona-fixture rows.
 * Pinned to a calendar date (not "now") so re-running the seed
 * produces byte-stable rows and contract tests can assert against a
 * deterministic value without fake-timers boilerplate.
 *
 * The same Date literal lives in `./seed.ts § SEED_BOOTSTRAP_EFFECTIVE_AT`
 * — duplicated here rather than imported because importing from `seed.ts`
 * would form a circular dependency once `seed.ts` re-exports
 * `seedFixtures` for the canonical `@repo/shared/db/seed` subpath. The
 * two literals are intentionally identical; if one moves, move both in
 * the same PR.
 */
const SEED_FIXTURE_EFFECTIVE_AT = new Date('2026-01-01T00:00:00.000Z');

/**
 * Static IDs for the persona-graph rows. Pinned constants (not
 * timestamps or randoms) so re-running the seed produces byte-stable
 * rows and contract tests can assert against deterministic values.
 *
 * The org / team IDs match the `PERSONA_FIXTURES.coach.orgId` and
 * `PERSONA_FIXTURES.coach.teamId` values verbatim — those values live
 * in `@repo/shared/testing/auth` but are *intentionally not imported*
 * here. `seedFixtures.ts` is production code (it gets bundled with the
 * Worker on a real `pnpm db:seed` run), and the dependency-cruiser
 * `test-helpers-only-in-tests` rule forbids production-side imports
 * into `src/testing/**`. The literals are duplicated; if `PERSONA_FIXTURES`
 * moves, move them here too.
 */
export const SEED_FIXTURE_ORG_ID = 'org_test_a' as const;
export const SEED_FIXTURE_TEAM_ID = 'team_test_a_1' as const;
export const SEED_FIXTURE_ATHLETE_USER_ID = 'user_seed_athlete' as const;
export const SEED_FIXTURE_COACH_USER_ID = 'user_seed_coach' as const;
export const SEED_FIXTURE_ORG_ADMIN_USER_ID = 'user_seed_org_admin' as const;
export const SEED_FIXTURE_ATHLETE_MEMBERSHIP_ID = 'am_seed_athlete' as const;
export const SEED_FIXTURE_COACH_ASSIGNMENT_ID = 'ca_seed_coach' as const;
export const SEED_FIXTURE_ROSTER_ENTRY_ID = 're_seed_athlete' as const;
export const SEED_FIXTURE_ROSTER_JERSEY_NUMBER = '10' as const;
export const SEED_FIXTURE_ROSTER_PRIMARY_POSITION = 'Forward' as const;

/**
 * Story #986 additions (F31 + F36). The Session-4 QA Plans need more
 * than the single-athlete, single-team graph above:
 *
 *   - F31 (`tp-coach-roster-edit-remove`) needs a SECOND athlete on the
 *     coach's team (`team_test_a_1`) so the "control row unchanged"
 *     assertions have a row to check against.
 *   - F36 (`tp-coach-roster-team-scoped-access`) needs THREE distinct
 *     teams: the coach's assigned team, a second team in the SAME org,
 *     and a team in a DIFFERENT org — to drive the cross-team and
 *     cross-org refusal cases.
 *
 * The extra athletes are not bootstrap personas (only athlete/coach/
 * org-admin map to real Clerk users), so they carry synthetic
 * `user_test_*` subject stubs.
 */
export const SEED_FIXTURE_ORG_B_ID = 'org_test_b' as const;
export const SEED_FIXTURE_TEAM_A2_ID = 'team_test_a_2' as const;
export const SEED_FIXTURE_TEAM_B1_ID = 'team_test_b_1' as const;
export const SEED_FIXTURE_ATHLETE_B_USER_ID = 'user_seed_athlete_b' as const;
export const SEED_FIXTURE_ATHLETE_A2_USER_ID = 'user_seed_athlete_a2' as const;
export const SEED_FIXTURE_ATHLETE_B1_USER_ID = 'user_seed_athlete_b1' as const;
export const SEED_FIXTURE_ATHLETE_B_MEMBERSHIP_ID = 'am_seed_athlete_b' as const;
export const SEED_FIXTURE_ATHLETE_A2_MEMBERSHIP_ID = 'am_seed_athlete_a2' as const;
export const SEED_FIXTURE_ATHLETE_B1_MEMBERSHIP_ID = 'am_seed_athlete_b1' as const;
export const SEED_FIXTURE_ROSTER_ENTRY_B_ID = 're_seed_athlete_b' as const;
export const SEED_FIXTURE_ROSTER_ENTRY_A2_ID = 're_seed_athlete_a2' as const;
export const SEED_FIXTURE_ROSTER_ENTRY_B1_ID = 're_seed_athlete_b1' as const;

/**
 * Minimal structural shape for the Drizzle handle this seed uses. The
 * production Worker passes a `@libsql/client` handle; the unit test
 * passes a `better-sqlite3` handle. Both satisfy this contract because
 * Drizzle's `db.insert(table).values([...]).onConflictDoNothing().run()`
 * shape is uniform across both drivers.
 */
interface InsertChain {
  insert: (table: unknown) => {
    values: (rows: ReadonlyArray<Record<string, unknown>>) => {
      onConflictDoNothing: () => { run: () => unknown };
    };
  };
}

const E = SEED_FIXTURE_EFFECTIVE_AT;

// Compact row definitions, expanded to insert objects in `seedFixtures`.
// Tuples (rather than full object literals) keep the module small enough
// to stay above the maintainability floor (ADR-019) as the graph grows.
// The `user_test_*` clerk subjects are duplicated from `PERSONA_FIXTURES`
// in `@repo/shared/testing/auth` (the architecture rule forbids
// production-side imports from `src/testing/**`).

// [id, name]
const ORG_ROWS = [
  [SEED_FIXTURE_ORG_ID, 'Seeded Test Organization A'],
  [SEED_FIXTURE_ORG_B_ID, 'Seeded Test Organization B'],
] as const;

// [id, orgId, name, sport]
const TEAM_ROWS = [
  [SEED_FIXTURE_TEAM_ID, SEED_FIXTURE_ORG_ID, 'Seeded Test Team A1', 'soccer'],
  [SEED_FIXTURE_TEAM_A2_ID, SEED_FIXTURE_ORG_ID, 'Seeded Test Team A2', 'basketball'],
  [SEED_FIXTURE_TEAM_B1_ID, SEED_FIXTURE_ORG_B_ID, 'Seeded Test Team B1', 'volleyball'],
] as const;

// [id, clerkSubjectId, email, role, orgId, teamId]
const USER_ROWS = [
  [
    SEED_FIXTURE_ATHLETE_USER_ID,
    'user_test_athlete',
    'athlete@example.com',
    'member',
    SEED_FIXTURE_ORG_ID,
    null,
  ],
  [
    SEED_FIXTURE_COACH_USER_ID,
    'user_test_coach',
    'coach@example.com',
    'team_admin',
    SEED_FIXTURE_ORG_ID,
    SEED_FIXTURE_TEAM_ID,
  ],
  [
    SEED_FIXTURE_ORG_ADMIN_USER_ID,
    'user_test_org_admin',
    'org-admin@example.com',
    'org_admin',
    SEED_FIXTURE_ORG_ID,
    null,
  ],
  [
    SEED_FIXTURE_ATHLETE_B_USER_ID,
    'user_test_athlete_b',
    'b@example.com',
    'member',
    SEED_FIXTURE_ORG_ID,
    null,
  ],
  [
    SEED_FIXTURE_ATHLETE_A2_USER_ID,
    'user_test_athlete_a2',
    'a2@example.com',
    'member',
    SEED_FIXTURE_ORG_ID,
    null,
  ],
  [
    SEED_FIXTURE_ATHLETE_B1_USER_ID,
    'user_test_athlete_b1',
    'b1@example.com',
    'member',
    SEED_FIXTURE_ORG_B_ID,
    null,
  ],
] as const;

// [id, orgId, teamId, athleteUserId]
const MEMBERSHIP_ROWS = [
  [
    SEED_FIXTURE_ATHLETE_MEMBERSHIP_ID,
    SEED_FIXTURE_ORG_ID,
    SEED_FIXTURE_TEAM_ID,
    SEED_FIXTURE_ATHLETE_USER_ID,
  ],
  [
    SEED_FIXTURE_ATHLETE_B_MEMBERSHIP_ID,
    SEED_FIXTURE_ORG_ID,
    SEED_FIXTURE_TEAM_ID,
    SEED_FIXTURE_ATHLETE_B_USER_ID,
  ],
  [
    SEED_FIXTURE_ATHLETE_A2_MEMBERSHIP_ID,
    SEED_FIXTURE_ORG_ID,
    SEED_FIXTURE_TEAM_A2_ID,
    SEED_FIXTURE_ATHLETE_A2_USER_ID,
  ],
  [
    SEED_FIXTURE_ATHLETE_B1_MEMBERSHIP_ID,
    SEED_FIXTURE_ORG_B_ID,
    SEED_FIXTURE_TEAM_B1_ID,
    SEED_FIXTURE_ATHLETE_B1_USER_ID,
  ],
] as const;

// [id, orgId, teamId, athleteUserId, jerseyNumber, primaryPosition]
const ROSTER_ROWS = [
  [
    SEED_FIXTURE_ROSTER_ENTRY_ID,
    SEED_FIXTURE_ORG_ID,
    SEED_FIXTURE_TEAM_ID,
    SEED_FIXTURE_ATHLETE_USER_ID,
    SEED_FIXTURE_ROSTER_JERSEY_NUMBER,
    SEED_FIXTURE_ROSTER_PRIMARY_POSITION,
  ],
  [
    SEED_FIXTURE_ROSTER_ENTRY_B_ID,
    SEED_FIXTURE_ORG_ID,
    SEED_FIXTURE_TEAM_ID,
    SEED_FIXTURE_ATHLETE_B_USER_ID,
    '7',
    'Goalkeeper',
  ],
  [
    SEED_FIXTURE_ROSTER_ENTRY_A2_ID,
    SEED_FIXTURE_ORG_ID,
    SEED_FIXTURE_TEAM_A2_ID,
    SEED_FIXTURE_ATHLETE_A2_USER_ID,
    '22',
    'Center',
  ],
  [
    SEED_FIXTURE_ROSTER_ENTRY_B1_ID,
    SEED_FIXTURE_ORG_B_ID,
    SEED_FIXTURE_TEAM_B1_ID,
    SEED_FIXTURE_ATHLETE_B1_USER_ID,
    '11',
    'Setter',
  ],
] as const;

/**
 * Insert the persona-graph rows. Idempotent — calling this twice
 * produces no duplicate rows (every insert chains `.onConflictDoNothing()`
 * on the table primary key).
 *
 * Story #986 grew the graph to two orgs, three teams, and six athletes
 * for the multi-athlete / multi-team / multi-org coach QA Plans.
 *
 * Insert order matters because of the FK chain:
 *   organizations → teams → users → athlete_memberships
 *                                 → coach_assignments → roster_entries
 *
 * `teams` lands before `users` because `users.team_id` is a nullable FK
 * to `teams.id` and the coach persona carries a non-null `team_id`.
 */
export function seedFixtures(db: unknown): void {
  const handle = db as InsertChain;

  handle
    .insert(organizations)
    .values(ORG_ROWS.map(([id, name]) => ({ id, name, organizationType: 'CLUB' })))
    .onConflictDoNothing()
    .run();

  handle
    .insert(teams)
    .values(
      TEAM_ROWS.map(([id, orgId, name, sport]) => ({
        id,
        orgId,
        name,
        sport,
        season: '2026',
        ageGroup: 'U14',
      })),
    )
    .onConflictDoNothing()
    .run();

  handle
    .insert(users)
    .values(
      USER_ROWS.map(([id, clerkSubjectId, email, role, orgId, teamId]) => ({
        id,
        clerkSubjectId,
        email,
        role,
        orgId,
        teamId,
        onboardedAt: E,
      })),
    )
    .onConflictDoNothing()
    .run();

  handle
    .insert(athleteMemberships)
    .values(
      MEMBERSHIP_ROWS.map(([id, orgId, teamId, athleteUserId]) => ({
        id,
        orgId,
        teamId,
        athleteUserId,
      })),
    )
    .onConflictDoNothing()
    .run();

  handle
    .insert(coachAssignments)
    .values([
      {
        id: SEED_FIXTURE_COACH_ASSIGNMENT_ID,
        orgId: SEED_FIXTURE_ORG_ID,
        teamId: SEED_FIXTURE_TEAM_ID,
        coachUserId: SEED_FIXTURE_COACH_USER_ID,
      },
    ])
    .onConflictDoNothing()
    .run();

  // The roster surface (Epic #11) reads from `roster_entries` exclusively —
  // it is NOT a projection of `athlete_memberships`. Active rows only
  // (`ended_at = null`).
  handle
    .insert(rosterEntries)
    .values(
      ROSTER_ROWS.map(([id, orgId, teamId, athleteUserId, jerseyNumber, primaryPosition]) => ({
        id,
        orgId,
        teamId,
        athleteUserId,
        jerseyNumber,
        primaryPosition,
        endedAt: null,
        createdAt: E,
        updatedAt: E,
      })),
    )
    .onConflictDoNothing()
    .run();
}
