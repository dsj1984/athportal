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

import { existsSync } from 'node:fs';
import { dirname, isAbsolute, parse as parsePath, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from '@repo/shared/db/schema';
import Database from 'better-sqlite3';
import { type BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3';

/**
 * Walk up from this module's URL to the monorepo root (the directory
 * containing `pnpm-workspace.yaml`). This anchor is stable regardless
 * of `process.cwd()` — the Astro SSR worker can be launched from any
 * directory and the resolver still returns the same absolute path.
 *
 * Story #877 / Task #882 — fixes charter finding f-auth-fuzz-001
 * (tests/charters/identity/ec-identity-auth-fuzz.charter.md), where a
 * relative `TURSO_URL` mis-resolved against the SSR worker's CWD and
 * crashed `/internal/styleguide` with "Cannot open database because the
 * directory does not exist".
 *
 * Story #903 hardening — the prior implementation hard-coded a four-
 * directory climb that assumed Vite/Astro emitted SSR chunks at the
 * same depth as the source (`apps/web/src/lib/db.ts`). In production
 * the bundled chunk may land at `apps/web/dist/server/chunks/<hash>.mjs`
 * (six levels deep) or `apps/web/dist/server/entry.mjs` (four levels —
 * which would coincidentally pass the fixed climb), making the depth
 * unreliable. We now search upward for the first directory containing
 * `pnpm-workspace.yaml` (the canonical monorepo-root marker, declared
 * at the repo root since Epic #2). Throws when the marker cannot be
 * located within reasonable upward distance — a missing marker means
 * the runtime was bundled in a way the resolver cannot anchor against,
 * which is operator-facing rather than user-facing.
 */
export function findMonorepoRoot(startDir: string): string {
  const root = parsePath(startDir).root;
  let current = startDir;
  // Bound the walk to avoid infinite loops on weird mount points; 32
  // levels is well above any realistic depth (Vite chunks ~6 levels;
  // a deeply nested test fixture < 16).
  for (let i = 0; i < 32; i += 1) {
    if (existsSync(resolve(current, 'pnpm-workspace.yaml'))) {
      return current;
    }
    if (current === root) {
      break;
    }
    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  throw new Error(
    `findMonorepoRoot: walked upward from '${startDir}' but could not locate ` +
      `pnpm-workspace.yaml. The web runtime resolves relative TURSO_URL paths ` +
      `against the monorepo root; this resolver requires the marker file to be ` +
      `discoverable from the running module's directory.`,
  );
}

const MONOREPO_ROOT = findMonorepoRoot(dirname(fileURLToPath(import.meta.url)));

/**
 * Resolve the SQLite file path from `TURSO_URL`. The env contract
 * (`.env.example`) accepts a `file:` URL for local dev and a
 * `libsql://` URL for staging/production. Until the libSQL driver lands
 * (Epic #27) we strip the `file:` prefix and refuse a `libsql://`
 * caller loudly rather than silently opening the wrong DB.
 *
 * Relative `file:` paths are anchored against the monorepo root (the
 * directory containing `pnpm-workspace.yaml`) so the resolver returns a
 * stable absolute path regardless of `process.cwd()`. Absolute `file:`
 * paths are returned verbatim. Non-`file:` strings (legacy callers that
 * already passed an absolute or bare path) are returned unchanged so
 * this change cannot regress production callers that already supplied
 * an absolute URL.
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
  if (!raw.startsWith('file:')) {
    // Bare path — preserve historical behaviour for callers that already
    // pass an absolute filesystem path without the `file:` prefix.
    return raw;
  }
  const stripped = raw.slice('file:'.length);
  // Absolute `file:` URLs are honoured as-is. Relative `file:` URLs are
  // anchored against the monorepo root so the same env value resolves
  // identically from every CWD.
  return isAbsolute(stripped) ? stripped : resolve(MONOREPO_ROOT, stripped);
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
