/**
 * Test-only helper that builds an ephemeral in-memory SQLite handle with
 * the full onboarding schema (users, organizations, teams, legal_documents,
 * user_legal_agreements, parent_athlete_links) and returns a Drizzle
 * wrapper around it.
 *
 * The production `freshDb()` helper in `@repo/shared/testing/db` still
 * carries the older `users` shape (clerk_id, email-unique) used by Epic #7
 * fixtures; this helper is the bespoke harness for the query-module unit
 * tests landed by Story #555 and is intentionally NOT re-exported from the
 * `@repo/shared/testing` barrel.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database, { type Database as SqliteDatabase } from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { legalDocuments } from '../../schema/legalDocuments';
import { organizations } from '../../schema/organizations';
import { parentAthleteLinks } from '../../schema/parentAthleteLinks';
import { teams } from '../../schema/teams';
import { userLegalAgreements } from '../../schema/userLegalAgreements';
import { users } from '../../schema/users';

const __filename = fileURLToPath(import.meta.url);
const migrationsDir = join(__filename, '..', '..', '..', 'migrations');

const schema = {
  legalDocuments,
  organizations,
  parentAthleteLinks,
  teams,
  userLegalAgreements,
  users,
};

export type OnboardingTestDb = ReturnType<typeof buildHandle>;

function buildHandle(client: SqliteDatabase) {
  return drizzle(client, { schema });
}

function loadMigration(filename: string): string {
  return readFileSync(join(migrationsDir, filename), 'utf8');
}

function applyMigration(client: SqliteDatabase, sql: string): void {
  // Drizzle migration files use `--> statement-breakpoint` markers between
  // executable statements. Splitting on that marker keeps each statement
  // isolated so better-sqlite3's single-statement `.exec()` boundary is
  // respected.
  const statements = sql
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const stmt of statements) {
    client.exec(stmt);
  }
}

/**
 * Create a fresh in-memory SQLite database with the onboarding schema
 * applied. The returned handle is a fully-featured Drizzle wrapper —
 * callers can `.select()`, `.insert()`, `.transaction()` etc. against it.
 *
 * Foreign-key enforcement is enabled so cascade and restrict semantics
 * mirror production.
 */
export function freshOnboardingDb(): OnboardingTestDb {
  const client = new Database(':memory:');
  client.pragma('foreign_keys = ON');
  applyMigration(client, loadMigration('0000_auth_and_rbac.sql'));
  applyMigration(client, loadMigration('0001_onboarding_schema.sql'));
  return buildHandle(client);
}
