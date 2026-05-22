/**
 * Test-only ephemeral SQLite for the scopedDb contract test (Story #607,
 * Task #621).
 *
 * Applies the 0000/0001 migrations plus inline DDL for the two new
 * graph tables (`coach_assignments`, `athlete_memberships`) that
 * Story #609 will migrate. Keeping the DDL inline here — rather than
 * authoring `0002_org_team_graph.sql` from this test — preserves the
 * Wave 1 parallel-execution boundary: Story #609 owns the migration
 * file, Story #607 owns the helper and the test.
 *
 * Not re-exported from `@repo/shared/testing`. Production code must not
 * reach this module.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database, { type Database as SqliteDatabase } from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { athleteMemberships } from '../../schema/athleteMemberships';
import { coachAssignments } from '../../schema/coachAssignments';
import { legalDocuments } from '../../schema/legalDocuments';
import { organizations } from '../../schema/organizations';
import { parentAthleteLinks } from '../../schema/parentAthleteLinks';
import { teams } from '../../schema/teams';
import { userLegalAgreements } from '../../schema/userLegalAgreements';
import { users } from '../../schema/users';

const __filename = fileURLToPath(import.meta.url);
const migrationsDir = join(__filename, '..', '..', '..', 'migrations');

const schema = {
  athleteMemberships,
  coachAssignments,
  legalDocuments,
  organizations,
  parentAthleteLinks,
  teams,
  userLegalAgreements,
  users,
};

export type GraphTestDb = ReturnType<typeof buildHandle>;

function buildHandle(client: SqliteDatabase) {
  return drizzle(client, { schema });
}

function loadMigration(filename: string): string {
  return readFileSync(join(migrationsDir, filename), 'utf8');
}

function applyMigration(client: SqliteDatabase, sql: string): void {
  const statements = sql
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const stmt of statements) {
    client.exec(stmt);
  }
}

/**
 * Inline DDL for the two graph join-tables. Mirrors the shape from
 * [`coachAssignments.ts`] and [`athleteMemberships.ts`] schema files.
 * Story #609 lands the canonical migration; this helper is the
 * Story #607 stand-in so the contract test can run independently
 * during the Wave 1 parallel cycle.
 */
/**
 * ALTER statements for columns that landed on the Epic #9 schema branch
 * (Stories #611 and #612) but whose migration file is owned by Story #609.
 * Applied between the 0001 migration and the join-table DDL so the
 * Drizzle schema and the SQLite shape agree during the Wave 1 parallel
 * cycle.
 */
/**
 * Build an ephemeral in-memory SQLite handle with the full graph schema
 * (organizations, teams, users, coachAssignments, athleteMemberships)
 * plus the legacy onboarding tables required by FK constraints.
 *
 * Applies the canonical migrations 0000, 0001, and 0002 directly so the
 * test surface matches the post-migration production shape — including
 * the table-rebuild that strips the temporary `organization_type`
 * DEFAULT, the cross-tenant CHECK triggers, and the PRAGMA wrap that
 * lets the rebuild step run with FK enforcement live. This replaces an
 * earlier inline DDL that diverged from the migration in two ways: it
 * kept the temporary DEFAULT (so an INSERT omitting organization_type
 * succeeded in the test fixture but failed in production with NOT NULL
 * constraint failed), and it omitted the CHECK triggers entirely.
 *
 * Foreign-key enforcement is enabled.
 */
export function freshGraphDb(): GraphTestDb {
  const client = new Database(':memory:');
  client.pragma('foreign_keys = ON');
  applyMigration(client, loadMigration('0000_auth_and_rbac.sql'));
  applyMigration(client, loadMigration('0001_onboarding_schema.sql'));
  applyMigration(client, loadMigration('0002_org_team_graph.sql'));
  applyMigration(client, loadMigration('0003_invitations.sql'));
  return buildHandle(client);
}
