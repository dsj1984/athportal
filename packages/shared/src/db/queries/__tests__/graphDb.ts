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
const GRAPH_ALTERS_DDL = `
ALTER TABLE organizations ADD COLUMN organization_type TEXT NOT NULL DEFAULT 'CLUB';
ALTER TABLE teams ADD COLUMN deleted_at INTEGER;
`;

const GRAPH_TABLES_DDL = `
CREATE TABLE IF NOT EXISTS coach_assignments (
  id TEXT PRIMARY KEY NOT NULL,
  org_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  coach_user_id TEXT NOT NULL,
  ended_at INTEGER,
  created_at INTEGER DEFAULT (unixepoch()) NOT NULL,
  updated_at INTEGER DEFAULT (unixepoch()) NOT NULL,
  FOREIGN KEY (org_id) REFERENCES organizations(id),
  FOREIGN KEY (team_id) REFERENCES teams(id),
  FOREIGN KEY (coach_user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS athlete_memberships (
  id TEXT PRIMARY KEY NOT NULL,
  org_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  athlete_user_id TEXT NOT NULL,
  ended_at INTEGER,
  created_at INTEGER DEFAULT (unixepoch()) NOT NULL,
  updated_at INTEGER DEFAULT (unixepoch()) NOT NULL,
  FOREIGN KEY (org_id) REFERENCES organizations(id),
  FOREIGN KEY (team_id) REFERENCES teams(id),
  FOREIGN KEY (athlete_user_id) REFERENCES users(id)
);
`;

/**
 * Build an ephemeral in-memory SQLite handle with the full graph schema
 * (organizations, teams, users, coachAssignments, athleteMemberships)
 * plus the legacy onboarding tables required by FK constraints.
 *
 * Foreign-key enforcement is enabled.
 */
export function freshGraphDb(): GraphTestDb {
  const client = new Database(':memory:');
  client.pragma('foreign_keys = ON');
  applyMigration(client, loadMigration('0000_auth_and_rbac.sql'));
  applyMigration(client, loadMigration('0001_onboarding_schema.sql'));
  client.exec(GRAPH_ALTERS_DDL);
  client.exec(GRAPH_TABLES_DDL);
  return buildHandle(client);
}
