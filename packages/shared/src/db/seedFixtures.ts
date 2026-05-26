/**
 * @repo/shared/db/seedFixtures — persona-graph seed for the QA-corpus
 * agent runner.
 *
 * Introduced by Epic #869 / Story #875 / Task #887. Tech Spec #871.
 *
 * The QA-corpus agent runner (and any operator running plans locally)
 * needs the canonical persona ↔ org ↔ team graph present in the local
 * SQLite DB before `/admin/*` plans can sign in and act. This seed
 * inserts one organization, the three synthetic persona users
 * (`athlete@example.com`, `coach@example.com`, `org-admin@example.com`)
 * with `onboarded_at` pinned to `SEED_BOOTSTRAP_EFFECTIVE_AT`, one team,
 * one athlete_memberships row, and one coach_assignments row. Every
 * insert uses Drizzle's `onConflictDoNothing` on the table primary key
 * for idempotence — the same pattern `seedLegalDocuments` uses.
 *
 * Persona ↔ org ↔ team mapping is sourced from `PERSONA_FIXTURES` in
 * `@repo/shared/testing/auth` so the persona ↔ identifier ↔ role
 * mapping stays single-source. The `clerk_subject_id` values are the
 * deterministic stubs the contract-tier middleware recognises; once
 * Story #876 lands the Clerk-persona-bootstrap runbook, the operator
 * may replace these with real `user_*` subject IDs in the same
 * `PERSONA_FIXTURES` record without touching this seed.
 *
 * The `dev_admin` persona is intentionally OUT OF SCOPE — see
 * Tech Spec #871 § Data Models. The operator's dev-admin Clerk identity
 * is provisioned per-developer via `scripts/seed-dev-admin.mjs`.
 *
 * Idempotence — calling `seedFixtures(db)` twice against the same
 * handle produces no duplicate rows (asserted by the unit test).
 */

import { PERSONA_FIXTURES } from '../testing/auth';
import { athleteMemberships } from './schema/athleteMemberships';
import { coachAssignments } from './schema/coachAssignments';
import { organizations } from './schema/organizations';
import { teams } from './schema/teams';
import { users } from './schema/users';
import { SEED_BOOTSTRAP_EFFECTIVE_AT } from './seed';

/**
 * Static IDs for the persona-graph rows. Pinned constants (not
 * timestamps or randoms) so re-running the seed produces byte-stable
 * rows and contract tests can assert against deterministic values.
 *
 * The org / team IDs match the `PERSONA_FIXTURES.coach.orgId` and
 * `PERSONA_FIXTURES.coach.teamId` values verbatim — single source of
 * truth lives in `@repo/shared/testing/auth`.
 */
export const SEED_FIXTURE_ORG_ID = 'org_test_a' as const;
export const SEED_FIXTURE_TEAM_ID = 'team_test_a_1' as const;
export const SEED_FIXTURE_ATHLETE_USER_ID = 'user_seed_athlete' as const;
export const SEED_FIXTURE_COACH_USER_ID = 'user_seed_coach' as const;
export const SEED_FIXTURE_ORG_ADMIN_USER_ID = 'user_seed_org_admin' as const;
export const SEED_FIXTURE_ATHLETE_MEMBERSHIP_ID = 'am_seed_athlete' as const;
export const SEED_FIXTURE_COACH_ASSIGNMENT_ID = 'ca_seed_coach' as const;

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

/**
 * Insert the persona-graph rows. Idempotent — calling this twice
 * produces no duplicate rows.
 *
 * The caller owns the DB handle (production Worker `@libsql/client` or
 * better-sqlite3 in tests). Each insert chains `.onConflictDoNothing()`
 * on the table primary key so the second run is a silent no-op.
 *
 * Insert order matters because the schema has FK constraints:
 *   organizations → teams → users → athlete_memberships
 *                                 → coach_assignments
 *
 * `teams` lands before `users` because `users.team_id` is a nullable
 * FK to `teams.id` — the coach persona carries a non-null `team_id`,
 * so the team row must exist first.
 */
export function seedFixtures(db: unknown): void {
  const handle = db as InsertChain;

  const athlete = PERSONA_FIXTURES.athlete;
  const coach = PERSONA_FIXTURES.coach;
  const orgAdmin = PERSONA_FIXTURES['org-admin'];

  handle
    .insert(organizations)
    .values([
      {
        id: SEED_FIXTURE_ORG_ID,
        name: 'Seeded Test Organization A',
        organizationType: 'CLUB',
      },
    ])
    .onConflictDoNothing()
    .run();

  handle
    .insert(teams)
    .values([
      {
        id: SEED_FIXTURE_TEAM_ID,
        orgId: SEED_FIXTURE_ORG_ID,
        name: 'Seeded Test Team A1',
        sport: 'soccer',
        season: '2026',
        ageGroup: 'U14',
      },
    ])
    .onConflictDoNothing()
    .run();

  handle
    .insert(users)
    .values([
      {
        id: SEED_FIXTURE_ATHLETE_USER_ID,
        clerkSubjectId: athlete.clerkSubjectId,
        email: athlete.email,
        role: athlete.role ?? 'member',
        orgId: SEED_FIXTURE_ORG_ID,
        teamId: null,
        onboardedAt: SEED_BOOTSTRAP_EFFECTIVE_AT,
      },
      {
        id: SEED_FIXTURE_COACH_USER_ID,
        clerkSubjectId: coach.clerkSubjectId,
        email: coach.email,
        role: coach.role ?? 'member',
        orgId: SEED_FIXTURE_ORG_ID,
        teamId: SEED_FIXTURE_TEAM_ID,
        onboardedAt: SEED_BOOTSTRAP_EFFECTIVE_AT,
      },
      {
        id: SEED_FIXTURE_ORG_ADMIN_USER_ID,
        clerkSubjectId: orgAdmin.clerkSubjectId,
        email: orgAdmin.email,
        role: orgAdmin.role ?? 'member',
        orgId: SEED_FIXTURE_ORG_ID,
        teamId: null,
        onboardedAt: SEED_BOOTSTRAP_EFFECTIVE_AT,
      },
    ])
    .onConflictDoNothing()
    .run();

  handle
    .insert(athleteMemberships)
    .values([
      {
        id: SEED_FIXTURE_ATHLETE_MEMBERSHIP_ID,
        orgId: SEED_FIXTURE_ORG_ID,
        teamId: SEED_FIXTURE_TEAM_ID,
        athleteUserId: SEED_FIXTURE_ATHLETE_USER_ID,
      },
    ])
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
}
