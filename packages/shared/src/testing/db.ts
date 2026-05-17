/**
 * @repo/shared/testing/db — `freshDb()` for contract tests.
 *
 * Returns an ephemeral, isolated Drizzle handle backed by a
 * better-sqlite3 database file in `os.tmpdir()` with a unique filename per
 * call. Each handle:
 *
 *   - Has the project schema applied (today: the example schema in
 *     `./schema.ts`; when the production Drizzle schema lands under
 *     `packages/shared/src/db/schema/**`, swap the import here).
 *   - Tracks itself in a module-level registry so the process can clean
 *     up tmp files on exit and so per-test teardown can call
 *     `closeAllTestDbs()` to release file handles.
 *
 * Story #172 / Task #175.
 */

import { randomUUID } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database, { type Database as SqliteDatabase } from 'better-sqlite3';
import { type BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3';
import { schema } from './schema';

export type FreshDbSchema = typeof schema;
export type TestDb = BetterSQLite3Database<FreshDbSchema>;

interface OpenHandle {
  readonly path: string;
  readonly client: SqliteDatabase;
}

const openHandles = new Set<OpenHandle>();
let exitHookInstalled = false;

function installExitHook(): void {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  const cleanup = () => closeAllTestDbs();
  process.once('exit', cleanup);
}

function applySchema(client: SqliteDatabase): void {
  client.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      clerk_id TEXT NOT NULL,
      email TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'org_admin',
      onboarded_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE UNIQUE INDEX IF NOT EXISTS users_clerk_id_unique ON users (clerk_id);
    CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users (email);

    CREATE TABLE IF NOT EXISTS resources (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL REFERENCES users(id),
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
}

/**
 * Build a fresh ephemeral SQLite-backed Drizzle handle. Two calls always
 * return two distinct handles backed by different tmp files.
 *
 * The handle is augmented with a non-enumerable `__filename` property so
 * tests can assert per-call uniqueness without reaching into Drizzle
 * internals.
 */
export function freshDb(): TestDb & { readonly __filename: string } {
  installExitHook();
  const filename = `athportal-test-${Date.now()}-${randomUUID()}.sqlite`;
  const path = join(tmpdir(), filename);
  const client = new Database(path);
  client.pragma('journal_mode = WAL');
  client.pragma('foreign_keys = ON');
  applySchema(client);
  const db = drizzle(client, { schema }) as TestDb;
  openHandles.add({ path, client });
  Object.defineProperty(db, '__filename', {
    value: path,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return db as TestDb & { readonly __filename: string };
}

/**
 * Close every open test database and best-effort remove its tmp file.
 * Safe to call multiple times — idempotent. Called automatically on
 * process exit; suites that want eager teardown (e.g. in `afterEach`)
 * may call it explicitly.
 */
export function closeAllTestDbs(): void {
  for (const handle of openHandles) {
    try {
      handle.client.close();
    } catch {
      // already closed; ignore
    }
    try {
      unlinkSync(handle.path);
    } catch {
      // file may have been removed by the OS or another worker; ignore
    }
  }
  openHandles.clear();
}
