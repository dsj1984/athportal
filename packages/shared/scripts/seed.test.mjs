// packages/shared/scripts/seed.test.mjs
//
// Unit tests for the seed / reset safety guard. The guard is the only
// thing standing between an accidentally-exported `DATABASE_URL=libsql://…`
// and a destructive `pnpm db:reset` against a remote endpoint, so it
// gets explicit coverage. Also covers the path-resolution defaults so
// the canonical "no env var set" case lands on the canonical local
// file. Story #875 / Task #885.

import { describe, expect, it } from 'vitest';
import { assertLocalDbPath, resolveLocalDbPath } from './seedPath.mjs';

const FAKE_REPO_ROOT = process.platform === 'win32' ? 'C:\\fake\\repo' : '/fake/repo';

const expectedLocalDb =
  process.platform === 'win32'
    ? 'C:\\fake\\repo\\packages\\shared\\data\\local.db'
    : '/fake/repo/packages/shared/data/local.db';

describe('resolveLocalDbPath', () => {
  it('defaults to packages/shared/data/local.db when neither env var is set', () => {
    const resolved = resolveLocalDbPath({ env: {}, repoRoot: FAKE_REPO_ROOT });
    expect(resolved).toBe(expectedLocalDb);
  });

  it('honours a file: URL relative to the repo root', () => {
    const resolved = resolveLocalDbPath({
      env: { DATABASE_URL: 'file:packages/shared/data/local.db' },
      repoRoot: FAKE_REPO_ROOT,
    });
    expect(resolved).toBe(expectedLocalDb);
  });

  it('prefers DATABASE_URL over TURSO_URL when both are set', () => {
    const resolved = resolveLocalDbPath({
      env: {
        DATABASE_URL: 'file:packages/shared/data/local.db',
        TURSO_URL: 'libsql://something.turso.io',
      },
      repoRoot: FAKE_REPO_ROOT,
    });
    expect(resolved).toBe(expectedLocalDb);
  });

  it('returns a non-file URL verbatim so the assert helper can reject it', () => {
    const resolved = resolveLocalDbPath({
      env: { DATABASE_URL: 'libsql://staging.turso.io' },
      repoRoot: FAKE_REPO_ROOT,
    });
    expect(resolved).toBe('libsql://staging.turso.io');
  });
});

describe('assertLocalDbPath', () => {
  it('passes for the canonical local.db path', () => {
    expect(() => assertLocalDbPath(expectedLocalDb, { repoRoot: FAKE_REPO_ROOT })).not.toThrow();
  });

  it('rejects a libsql:// URL', () => {
    expect(() =>
      assertLocalDbPath('libsql://staging.turso.io', { repoRoot: FAKE_REPO_ROOT }),
    ).toThrow(/refuse to run against a non-file URL/);
  });

  it('rejects an http:// URL', () => {
    expect(() => assertLocalDbPath('http://example.com/db', { repoRoot: FAKE_REPO_ROOT })).toThrow(
      /refuse to run against a non-file URL/,
    );
  });

  it('rejects an absolute path outside packages/shared/data/', () => {
    const outside = process.platform === 'win32' ? 'C:\\tmp\\local.db' : '/tmp/local.db';
    expect(() => assertLocalDbPath(outside, { repoRoot: FAKE_REPO_ROOT })).toThrow(
      /Only paths under .* are allowed/,
    );
  });

  it('rejects a path that escapes via .. segments', () => {
    const escapes =
      process.platform === 'win32'
        ? 'C:\\fake\\repo\\packages\\shared\\data\\..\\..\\..\\elsewhere\\local.db'
        : '/fake/repo/packages/shared/data/../../../elsewhere/local.db';
    expect(() => assertLocalDbPath(escapes, { repoRoot: FAKE_REPO_ROOT })).toThrow(
      /Only paths under .* are allowed/,
    );
  });
});
