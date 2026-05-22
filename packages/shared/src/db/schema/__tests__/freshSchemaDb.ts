/**
 * Test-only ephemeral SQLite for the Epic #9 schema contract tests
 * (Story #617).
 *
 * Applies the canonical 0000 + 0001 + 0002 migrations from
 * `packages/shared/src/db/migrations/`. Migration 0002 brings in the
 * CHECK triggers on `coach_assignments` and `athlete_memberships` that
 * the contract tests exercise — keeping the trigger DDL inside the
 * canonical migration file (rather than re-declaring it here) ensures
 * the contract tests catch any future drift between the migration the
 * production database receives and the constraint surface the tests
 * pin.
 *
 * Not re-exported from `@repo/shared/testing`. Production code must not
 * reach this module.
 *
 * Sibling of `packages/shared/src/db/queries/__tests__/graphDb.ts`,
 * which predates the merge of Story #609's migration file and uses
 * inline DDL without the triggers. The two helpers serve different
 * Wave 1 / Wave 2 boundaries and are intentionally kept separate.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database, { type Database as SqliteDatabase } from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { athleteMemberships } from '../athleteMemberships';
import { coachAssignments } from '../coachAssignments';
import { legalDocuments } from '../legalDocuments';
import { organizations } from '../organizations';
import { parentAthleteLinks } from '../parentAthleteLinks';
import { teams } from '../teams';
import { userLegalAgreements } from '../userLegalAgreements';
import { users } from '../users';

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

export type SchemaTestDb = ReturnType<typeof buildHandle>;

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
 * Build an ephemeral in-memory SQLite handle with the full Epic #9
 * schema graph applied via the canonical migrations 0000, 0001, and
 * 0002. Foreign-key enforcement is enabled so FK violations surface
 * the same way they do in production.
 */
export function freshSchemaDb(): SchemaTestDb {
  const client = new Database(':memory:');
  client.pragma('foreign_keys = ON');
  applyMigration(client, loadMigration('0000_auth_and_rbac.sql'));
  applyMigration(client, loadMigration('0001_onboarding_schema.sql'));
  applyMigration(client, loadMigration('0002_org_team_graph.sql'));
  applyMigration(client, loadMigration('0003_invitations.sql'));
  applyMigration(client, loadMigration('0004_org_branding.sql'));
  applyMigration(client, loadMigration('0005_team_metadata.sql'));
  applyMigration(client, loadMigration('0006_csv_import_batches.sql'));
  return buildHandle(client);
}
