// packages/shared/scripts/seed.smoke.test.mjs
//
// Parity smoke test pinning the runtime `seed.mjs § applySeed` against
// the table set written by the canonical TS fixture
// `src/db/seedFixtures.ts § seedFixtures`. The two surfaces have to be
// kept in lockstep by hand (see the file header on both); this test
// catches the next time one drifts.
//
// Background — Story #981. PR #940 added a `roster_entries` insert to
// the TS fixture but missed the .mjs script. The TS unit test
// (`seedFixtures.test.ts`) passed because it exercises the TS module
// directly, leaving the runtime path that `pnpm db:seed` actually
// invokes unpinned. This test plugs that gap by applying the full
// migration chain to an in-memory SQLite DB, running `applySeed`, and
// asserting every table the TS fixture also writes to has at least one
// row.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { applySeed } from './seed.mjs';

const __filename = fileURLToPath(import.meta.url);
const MIGRATIONS_DIR = resolvePath(
  dirname(__filename),
  '..',
  'src',
  'db',
  'migrations',
);

// Mirrors FIXTURE_MIGRATIONS in seedFixtures.test.ts plus 0008 so the
// production schema is fully applied. Keep in lockstep with the
// migrations directory.
const MIGRATIONS = [
  '0000_auth_and_rbac.sql',
  '0001_onboarding_schema.sql',
  '0002_org_team_graph.sql',
  '0003_invitations.sql',
  '0004_org_branding.sql',
  '0005_team_metadata.sql',
  '0006_csv_import_batches.sql',
  '0007_roster.sql',
  '0008_csv_import_batch_filename.sql',
];

// Every table `seedFixtures.ts § seedFixtures` writes to. If the TS
// fixture grows a new write, add the table here in the same PR — that
// is the contract this test exists to enforce.
const PARITY_TABLES = [
  'organizations',
  'teams',
  'users',
  'athlete_memberships',
  'coach_assignments',
  'roster_entry',
];

function applyMigration(client, sql) {
  const statements = sql
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const stmt of statements) {
    client.exec(stmt);
  }
}

function freshDb() {
  const client = new Database(':memory:');
  client.pragma('foreign_keys = ON');
  for (const filename of MIGRATIONS) {
    applyMigration(client, readFileSync(join(MIGRATIONS_DIR, filename), 'utf8'));
  }
  return client;
}

describe('seed.mjs § applySeed parity with src/db/seedFixtures.ts', () => {
  it('writes at least one row into every table the TS fixture also writes to', () => {
    const client = freshDb();
    try {
      applySeed(client);
      for (const table of PARITY_TABLES) {
        const { count } = client.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get();
        expect(count, `expected at least 1 row in ${table}`).toBeGreaterThanOrEqual(1);
      }
    } finally {
      client.close();
    }
  });

  it('is idempotent — re-running does not duplicate rows', () => {
    const client = freshDb();
    try {
      applySeed(client);
      const baseline = Object.fromEntries(
        PARITY_TABLES.map((table) => [
          table,
          client.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count,
        ]),
      );
      applySeed(client);
      applySeed(client);
      for (const table of PARITY_TABLES) {
        const { count } = client.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get();
        expect(count, `${table} grew on re-run`).toBe(baseline[table]);
      }
    } finally {
      client.close();
    }
  });

  it('seeds the exact roster_entry row src/db/seedFixtures.ts writes', () => {
    const client = freshDb();
    try {
      applySeed(client);
      const row = client
        .prepare('SELECT * FROM roster_entry WHERE id = ?')
        .get('re_seed_athlete');
      expect(row).toBeDefined();
      expect(row.org_id).toBe('org_test_a');
      expect(row.team_id).toBe('team_test_a_1');
      expect(row.athlete_user_id).toBe('user_seed_athlete');
      expect(row.jersey_number).toBe('10');
      expect(row.primary_position).toBe('Forward');
      expect(row.ended_at).toBeNull();
    } finally {
      client.close();
    }
  });
});
