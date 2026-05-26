// apps/web/src/lib/db.contract.test.ts
//
// Contract test for resolveDatabasePath() — Story #877 / Task #879.
//
// Dispositions charter finding f-auth-fuzz-001
// (tests/charters/identity/ec-identity-auth-fuzz.charter.md). The finding
// observes that the SSR /internal/styleguide route crashes with
// "Cannot open database because the directory does not exist" when the
// Astro SSR worker is launched from a CWD that is not the monorepo root,
// because resolveDatabasePath() strips the `file:` prefix and returns the
// raw (relative) path. better-sqlite3 then resolves that path against the
// worker's CWD, which is not guaranteed to be the repo root.
//
// This test parameterises three CWDs (repo root, apps/web/, and a deep
// tmp directory) and asserts that, given the canonical relative
// `TURSO_URL` from .env.example, getDb() — which calls resolveDatabasePath()
// and hands the result to better-sqlite3 — opens without throwing from
// every CWD.
//
// The test seeds an absolute SQLite file at the canonical anchor
// (<repo-root>/packages/shared/data/local.db) before each case so the
// "correct" resolution always points at a real file. If the resolver
// returns the raw relative path (the bug), better-sqlite3 will fail to
// open the file from CWDs where the relative path does not resolve to a
// real file.
//
// Contract tier per docs/testing-strategy.md and
// .agents/rules/testing-standards.md § Contract — exercises a boundary
// (env → resolver → driver) using a real SQLite file, not a mock.

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Walk up from the test file to the monorepo root (the directory
 * containing `pnpm-workspace.yaml`). This is the anchor the resolver
 * SHOULD use; the test computes it the same way so it can seed the
 * canonical SQLite file before each assertion.
 */
function findRepoRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // here = <repo>/apps/web/src/lib → climb four levels to <repo>.
  return resolve(here, '..', '..', '..', '..');
}

const REPO_ROOT = findRepoRoot();
const CANONICAL_DB_DIR = join(REPO_ROOT, 'packages', 'shared', 'data');
const CANONICAL_DB_PATH = join(CANONICAL_DB_DIR, 'local.db');

/**
 * Canonical relative URL straight from `.env.example`. The bug is that
 * this string was being returned verbatim to better-sqlite3, which then
 * resolved it against `process.cwd()` — only the repo root happened to
 * line up with the value. The fix anchors relative `file:` URLs against
 * the monorepo root (the directory containing pnpm-workspace.yaml) so
 * the resolver returns the same absolute path from every CWD.
 *
 * The charter finding (f-auth-fuzz-001) reproduces the same bug with
 * the `file:../../packages/shared/data/local.db` form (the way a
 * developer would write it from inside apps/web/); both forms exhibit
 * the same CWD-sensitivity. We test the canonical `.env.example` form
 * because that is the value every consumer ships with by default and
 * therefore the value the fix MUST keep working.
 */
const RELATIVE_TURSO_URL = 'file:packages/shared/data/local.db';

let originalCwd: string;
let originalTursoUrl: string | undefined;
let tmpDeepDir: string;

beforeAll(() => {
  originalCwd = process.cwd();
  originalTursoUrl = process.env.TURSO_URL;
  // Seed the canonical SQLite file once for the whole suite. better-sqlite3
  // creates the file on open if the directory exists, so an empty
  // placeholder is sufficient — we are testing the resolver, not the
  // schema.
  mkdirSync(CANONICAL_DB_DIR, { recursive: true });
  if (!existsSync(CANONICAL_DB_PATH)) {
    writeFileSync(CANONICAL_DB_PATH, '');
  }
  // A deep, synthetic CWD outside the repo tree — the OS tmpdir plus a
  // nested subdirectory so we exercise "resolver called from a worker
  // launched from an arbitrary directory" semantics.
  tmpDeepDir = join(tmpdir(), 'athportal-resolveDatabasePath-test', 'nested', 'deep');
  mkdirSync(tmpDeepDir, { recursive: true });
});

afterAll(() => {
  process.chdir(originalCwd);
  if (originalTursoUrl === undefined) {
    process.env.TURSO_URL = undefined;
  } else {
    process.env.TURSO_URL = originalTursoUrl;
  }
  // Best-effort cleanup of the synthetic CWD; ignore failures because the
  // OS may still be holding handles on Windows.
  try {
    rmSync(join(tmpdir(), 'athportal-resolveDatabasePath-test'), {
      recursive: true,
      force: true,
    });
  } catch {
    // Intentionally ignored — Windows may still hold file handles.
  }
});

beforeEach(() => {
  process.env.TURSO_URL = RELATIVE_TURSO_URL;
  // Astro's runtime exposes import.meta.env.TURSO_URL when an apps/web
  // `.env` is present. Vitest does not load apps/web/.env into
  // import.meta.env, but stub it defensively so the resolver's read of
  // import.meta.env is deterministic.
  vi.stubEnv('TURSO_URL', RELATIVE_TURSO_URL);
  vi.resetModules();
});

afterEach(() => {
  process.chdir(originalCwd);
  vi.unstubAllEnvs();
});

/**
 * Each row drives one Arrange / Act / Assert pass against a different
 * CWD. The resolver must produce a path that better-sqlite3 can open in
 * every row.
 */
const CWD_MATRIX: ReadonlyArray<{ name: string; cwd: () => string }> = [
  { name: 'repo root', cwd: () => REPO_ROOT },
  { name: 'apps/web/', cwd: () => join(REPO_ROOT, 'apps', 'web') },
  { name: 'deep tmp directory outside the repo', cwd: () => tmpDeepDir },
];

describe('resolveDatabasePath() — contract across CWDs (f-auth-fuzz-001)', () => {
  for (const row of CWD_MATRIX) {
    it(`getDb() opens the canonical SQLite file when CWD = ${row.name}`, async () => {
      // Arrange — re-seed the canonical file (in case a parallel run
      // wiped it), then move into the parameterised CWD.
      mkdirSync(CANONICAL_DB_DIR, { recursive: true });
      if (!existsSync(CANONICAL_DB_PATH)) {
        writeFileSync(CANONICAL_DB_PATH, '');
      }
      process.chdir(row.cwd());

      // Act — dynamic import so the resolver re-reads the stubbed env
      // and the cached drizzle handle is rebuilt from scratch.
      const mod = await import('./db');
      const { getDb, __resetDbForTests } = mod;
      __resetDbForTests();

      // Assert — getDb() must not throw, regardless of the CWD. This is
      // the load-bearing assertion: the resolver's job is to hand the
      // driver a string that opens cleanly from anywhere.
      expect(() => {
        const db = getDb();
        // Touch the handle to force an actual file open / read. Drizzle
        // exposes the underlying better-sqlite3 client at `$client`.
        const client = (db as unknown as { $client: { pragma: (q: string) => unknown } }).$client;
        client.pragma('user_version');
      }).not.toThrow();

      // Cleanup — close the opened handle so the next iteration's
      // __resetDbForTests + open isn't holding a stale file descriptor.
      const db = getDb();
      const client = (db as unknown as { $client: { close: () => void } }).$client;
      client.close();
      __resetDbForTests();
    });
  }
});
