/**
 * Contract test — migration 0007_roster.sql applies cleanly and creates
 * both new tables with the expected indexes (Epic #11 / Story #910 /
 * Task #914).
 *
 * Pins the migration's surface as observed via SQLite's `sqlite_master`
 * catalogue: the two `CREATE TABLE` statements, the three indexes on
 * `roster_entry`, the four indexes on `roster_invite`, and the four
 * cross-tenant triggers. If the migration drifts (e.g. an index is
 * dropped or renamed in a future Story) this test fails before merge.
 */

import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { freshSchemaDb } from './freshSchemaDb';

interface SqliteMasterRow {
  type: string;
  name: string;
  tbl_name: string;
}

/**
 * Read the SQLite catalogue via Drizzle's `sql` template + `.all()` —
 * the typed surface that Drizzle exposes for raw queries. Returning
 * rows from `sqlite_master` is by definition implementation-level
 * introspection, so the test bypasses the relational query API.
 */
function listObjects(
  db: ReturnType<typeof freshSchemaDb>,
  type: string,
  tblName: string,
): SqliteMasterRow[] {
  const rows = db.all<SqliteMasterRow>(
    sql`SELECT type, name, tbl_name FROM sqlite_master WHERE type = ${type} AND tbl_name = ${tblName}`,
  );
  return rows;
}

describe('migration 0007_roster — schema surface', () => {
  it('creates the roster_entry table', () => {
    const db = freshSchemaDb();
    const rows = listObjects(db, 'table', 'roster_entry');
    expect(rows.length).toBe(1);
    expect(rows[0]?.name).toBe('roster_entry');
  });

  it('creates the roster_invite table', () => {
    const db = freshSchemaDb();
    const rows = listObjects(db, 'table', 'roster_invite');
    expect(rows.length).toBe(1);
    expect(rows[0]?.name).toBe('roster_invite');
  });

  it('declares the expected indexes on roster_entry', () => {
    const db = freshSchemaDb();
    const indexes = listObjects(db, 'index', 'roster_entry')
      .map((r) => r.name)
      .filter((n) => !n.startsWith('sqlite_autoindex_'))
      .sort();
    expect(indexes).toEqual([
      'roster_entry_org_team_idx',
      'roster_entry_team_athlete_active_unique',
      'roster_entry_team_ended_idx',
    ]);
  });

  it('declares the expected indexes on roster_invite', () => {
    const db = freshSchemaDb();
    const indexes = listObjects(db, 'index', 'roster_invite')
      .map((r) => r.name)
      .filter((n) => !n.startsWith('sqlite_autoindex_'))
      .sort();
    expect(indexes).toEqual([
      'roster_invite_email_idx',
      'roster_invite_org_id_idx',
      'roster_invite_team_status_idx',
      'roster_invite_token_hash_unique',
    ]);
  });

  it('declares the cross-tenant triggers on both tables', () => {
    const db = freshSchemaDb();
    const entryTriggers = listObjects(db, 'trigger', 'roster_entry')
      .map((r) => r.name)
      .sort();
    const inviteTriggers = listObjects(db, 'trigger', 'roster_invite')
      .map((r) => r.name)
      .sort();
    expect(entryTriggers).toEqual([
      'roster_entry_cross_tenant_insert_check',
      'roster_entry_cross_tenant_update_check',
    ]);
    expect(inviteTriggers).toEqual([
      'roster_invite_cross_tenant_insert_check',
      'roster_invite_cross_tenant_update_check',
    ]);
  });
});
