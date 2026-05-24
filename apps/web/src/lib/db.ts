// apps/web/src/lib/db.ts
//
// Lazy-singleton Drizzle handle for the web runtime.
//
// Story #749 / Task #752 wires the first production DB binding for
// `apps/web` so the `/internal/styleguide` gate can resolve a Clerk
// subject to an internal `users` row and read its `role` column.
//
// Driver — `better-sqlite3` against the local SQLite file pointed at by
// `TURSO_URL` (default `file:packages/shared/data/local.db` per
// `.env.example`). The web runtime's MVP target is the SSR-Node adapter
// running locally; the Turso/libSQL swap lands with Epic #27 (Tech Spec
// #743). When that swap happens this module is the single call site that
// changes — every consumer reads `getDb()`.
//
// Caching — the handle is cached at module scope because constructing a
// `better-sqlite3` instance opens a file descriptor; reusing it across
// requests is the documented pattern. The handle is created lazily on
// first call so importing this module from a context that does not need
// the DB (a test that mocks the module, a build-time evaluation) does
// not touch the filesystem.

import * as schema from '@repo/shared/db/schema';
import Database from 'better-sqlite3';
import { type BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3';

/**
 * Resolve the SQLite file path from `TURSO_URL`. The env contract
 * (`.env.example`) accepts a `file:` URL for local dev and a
 * `libsql://` URL for staging/production. Until the libSQL driver lands
 * (Epic #27) we strip the `file:` prefix and refuse a `libsql://`
 * caller loudly rather than silently opening the wrong DB.
 */
function resolveDatabasePath(): string {
  // Astro/Vite auto-loads .env into import.meta.env for the SSR runtime;
  // process.env is only populated when the operator exports the var into
  // the shell before launching. Prefer import.meta.env so the local-dev
  // path "just works" with apps/web/.env, fall back to process.env for
  // CI / explicit shell exports.
  const importMetaEnv = (import.meta as unknown as { env?: Record<string, string | undefined> })
    .env;
  const raw = importMetaEnv?.TURSO_URL || process.env.TURSO_URL;
  if (!raw || raw.length === 0) {
    throw new Error(
      'TURSO_URL is not set. The web runtime requires a local SQLite path ' +
        '(file:packages/shared/data/local.db by default) — see .env.example.',
    );
  }
  if (raw.startsWith('libsql://')) {
    throw new Error(
      'TURSO_URL points to a libsql:// endpoint, but the web runtime is ' +
        'currently wired to better-sqlite3. The libSQL adapter swap lands with ' +
        'Epic #27. Use a file: URL for local dev.',
    );
  }
  return raw.startsWith('file:') ? raw.slice('file:'.length) : raw;
}

export type WebDb = BetterSQLite3Database<typeof schema>;

let cached: WebDb | null = null;

/**
 * Lazy accessor for the web runtime's Drizzle handle.
 *
 * The first call opens the SQLite file and constructs the Drizzle proxy;
 * subsequent calls return the cached handle. The handle is intentionally
 * not exposed as a module-level constant — eager construction would run
 * at module-load time, which is the wrong moment for a file-descriptor
 * acquisition in an SSR context that may be imported from build tooling
 * that does not need the DB.
 */
export function getDb(): WebDb {
  if (cached) return cached;
  const client = new Database(resolveDatabasePath(), { readonly: false });
  cached = drizzle(client, { schema });
  return cached;
}

/**
 * Test-only escape hatch: clears the cached handle so a subsequent
 * `getDb()` re-reads the env. Not exported from any production code path.
 */
export function __resetDbForTests(): void {
  cached = null;
}
