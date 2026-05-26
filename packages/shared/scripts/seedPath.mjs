// packages/shared/scripts/seedPath.mjs
//
// Shared helper for the seed / reset CLI entrypoints. Resolves the local
// SQLite path the operator wants the seed to land in, and refuses to
// operate when the resolved path is not under `packages/shared/data/`.
//
// The guard exists because the same DB env var (`DATABASE_URL` /
// `TURSO_URL`) gets exported in plenty of shells that already point at
// staging libsql URLs or other absolute paths. `pnpm db:seed` is meant
// to be a local-only convenience surface — running it against anything
// other than the per-developer SQLite file is a data-loss footgun.
//
// Story #875 / Task #885 (Tech Spec #871 § Security & Privacy).

import { resolve as resolvePath } from 'node:path';

/**
 * The expected directory the local SQLite file lives in. Anything that
 * resolves outside this directory is rejected by `assertLocalDbPath`.
 */
export const LOCAL_DB_DIR_SEGMENT = 'packages/shared/data';

/**
 * Resolve the local-DB filesystem path the seed / reset CLIs should
 * operate on. Reads `DATABASE_URL` first (matches the local-dev contract
 * in `.env.example`), falls back to `TURSO_URL`, and finally to the
 * project default `file:packages/shared/data/local.db`.
 *
 * Accepts:
 *   - `file:packages/shared/data/local.db` (relative — resolved against
 *     the supplied `repoRoot`).
 *   - `file:/absolute/path/local.db` (absolute file URL).
 *   - An already-absolute or already-relative bare path (no scheme).
 *
 * Rejects (caller decides — this function only normalises):
 *   - `libsql://…` and any other non-`file:` scheme. Callers should
 *     feed the rejection through `assertLocalDbPath` for the canonical
 *     error message.
 *
 * The function does NOT touch the filesystem; it is a pure path
 * resolver so the unit tests can drive it deterministically.
 */
export function resolveLocalDbPath({ env, repoRoot }) {
  const raw = (env.DATABASE_URL ?? env.TURSO_URL ?? '').trim();
  if (raw === '') {
    // Default the operator into the canonical local file rather than
    // throwing — `pnpm db:seed` should "just work" on a fresh clone.
    return resolvePath(repoRoot, LOCAL_DB_DIR_SEGMENT, 'local.db');
  }
  if (raw.startsWith('file:')) {
    return resolvePath(repoRoot, raw.slice('file:'.length));
  }
  // Any other scheme (libsql, http, https) is surfaced verbatim so the
  // assert helper can produce a precise rejection message.
  return raw;
}

/**
 * Assert the resolved DB path is under `packages/shared/data/`. Throws
 * a single descriptive Error otherwise — the CLI entrypoints catch the
 * throw and exit non-zero with the message.
 *
 * The guard fires on:
 *   - A non-`file:` URL (e.g. `libsql://…`, `http://…`).
 *   - An absolute path outside the `packages/shared/data/` directory.
 *   - A relative path that, once resolved against `repoRoot`, leaves
 *     `packages/shared/data/` via `..` segments.
 */
export function assertLocalDbPath(resolvedPath, { repoRoot }) {
  if (resolvedPath.includes('://')) {
    throw new Error(
      `db:seed / db:reset refuse to run against a non-file URL (got ${resolvedPath.split('://')[0]}://…). ` +
        'These scripts operate only on the local SQLite file under packages/shared/data/. ' +
        'Unset DATABASE_URL / TURSO_URL or point them at file:packages/shared/data/local.db.',
    );
  }
  const allowedDir = resolvePath(repoRoot, LOCAL_DB_DIR_SEGMENT);
  const absolute = resolvePath(resolvedPath);
  // Append a separator before the prefix check so `/a/b` does not match
  // an allowedDir of `/a/bc`.
  const allowedPrefix = allowedDir.endsWith('/') || allowedDir.endsWith('\\')
    ? allowedDir
    : `${allowedDir}${process.platform === 'win32' ? '\\' : '/'}`;
  const candidate = absolute.endsWith('/') || absolute.endsWith('\\') ? absolute : `${absolute}`;
  if (candidate !== allowedDir && !candidate.startsWith(allowedPrefix)) {
    throw new Error(
      `db:seed / db:reset refuse to run against ${absolute}. ` +
        `Only paths under ${allowedDir} are allowed (guards against accidental ` +
        'remote-DB resets when DATABASE_URL / TURSO_URL is exported in the shell).',
    );
  }
}
