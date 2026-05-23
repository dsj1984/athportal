#!/usr/bin/env node
// scripts/seed-dev-admin.mjs
//
// Operator-facing one-shot: mark the matching user row in the local DB
// as `role = 'dev_admin'` so the operator's Clerk-provisioned account
// can reach `/_internal/styleguide`.
//
// Story #749 / Task #751 — operator unblocker that pairs with the real
// `productionRoleLookup` Drizzle read landed by Task #752. Until the
// Cloudflare/libSQL deploy lands (Epic #27) the local-dev DB is a
// SQLite file at `TURSO_URL` (default `file:packages/shared/data/local.db`
// per `.env.example`).
//
// Usage:
//   node scripts/seed-dev-admin.mjs --email <addr>
//
// Exit contract (Task #751 acceptance):
//   • 0  — match found and updated to `dev_admin`
//   • 0  — match already `dev_admin` (idempotent no-op)
//   • 1  — no row matches the email (script prints an error)
//   • 1  — malformed invocation / DB binding missing
//
// The script intentionally uses raw better-sqlite3 prepared statements
// rather than the Drizzle proxy so it has zero TypeScript-import
// surface: a `.mjs` Node script cannot import the schema's `.ts` file
// without a transpiler, and the `users` table contract is stable
// enough that pinning the column names here is cheaper than wiring
// `tsx` or `ts-node` for one query. If the `users` schema changes
// shape, this script must be updated in the same PR — the Drizzle
// schema at packages/shared/src/db/schema/users.ts remains the source
// of truth.

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Minimal --flag parser. Accepts `--email <addr>` only; rejects unknown
 * flags loudly so a typo never silently no-ops.
 */
function parseArgs(argv) {
  const args = { email: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--email') {
      args.email = argv[i + 1] ?? null;
      i++;
      continue;
    }
    if (token === '--help' || token === '-h') {
      args.help = true;
      continue;
    }
    return { error: `Unknown argument: ${token}` };
  }
  return { args };
}

function writeUsage(stream) {
  stream.write(
    'Usage: node scripts/seed-dev-admin.mjs --email <addr>\n' +
      '\n' +
      'Marks the matching users row in TURSO_URL as role=dev_admin so\n' +
      'the operator can reach /_internal/styleguide. Requires the Clerk\n' +
      'user to have signed in once so the JIT provisioning has created\n' +
      'the row. See docs/runbooks/seed-dev-admin.md.\n',
  );
}

/**
 * Resolve the SQLite file path from `TURSO_URL`. Mirrors the resolver in
 * `apps/web/src/lib/db.ts` so the script and the runtime open the same
 * database. Returns an absolute path so the script is callable from any
 * cwd.
 */
function resolveDatabasePath() {
  const raw = process.env.TURSO_URL;
  if (!raw || raw.length === 0) {
    throw new Error(
      'TURSO_URL is not set. Set it (default file:packages/shared/data/local.db) ' +
        'and re-run. See docs/runbooks/seed-dev-admin.md.',
    );
  }
  if (raw.startsWith('libsql://')) {
    throw new Error(
      'TURSO_URL points to a libsql:// endpoint, but this seed script is ' +
        'better-sqlite3-only. Point TURSO_URL at a local file: URL for dev.',
    );
  }
  const stripped = raw.startsWith('file:') ? raw.slice('file:'.length) : raw;
  return resolve(REPO_ROOT, stripped);
}

/**
 * Main entrypoint. Returns the process exit code rather than calling
 * `process.exit` directly so the function stays structurally testable.
 */
function run(argv) {
  const parsed = parseArgs(argv);
  if (parsed.error) {
    process.stderr.write(`${parsed.error}\n`);
    writeUsage(process.stderr);
    return 1;
  }
  if (parsed.args.help) {
    writeUsage(process.stdout);
    return 0;
  }
  const email = parsed.args.email;
  if (!email || email.length === 0) {
    process.stderr.write('Missing required --email <addr>.\n');
    writeUsage(process.stderr);
    return 1;
  }

  let dbPath;
  try {
    dbPath = resolveDatabasePath();
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    return 1;
  }
  if (!existsSync(dbPath)) {
    process.stderr.write(
      `SQLite file not found at ${dbPath}. Run the migration step from ` +
        'docs/runbooks/seed-dev-admin.md before re-running.\n',
    );
    return 1;
  }

  const client = new Database(dbPath);
  try {
    const selectStmt = client.prepare('SELECT id, role FROM users WHERE email = ? LIMIT 1');
    const row = selectStmt.get(email);
    if (!row) {
      process.stderr.write(
        `No user row matches email='${email}'. Sign in once via Clerk so the ` +
          'JIT provisioner creates the row, then re-run this script.\n',
      );
      return 1;
    }
    if (row.role === 'dev_admin') {
      process.stdout.write(`No-op: user '${email}' is already dev_admin.\n`);
      return 0;
    }
    const updateStmt = client.prepare("UPDATE users SET role = 'dev_admin' WHERE email = ?");
    updateStmt.run(email);
    process.stdout.write(`Updated user '${email}' (was role='${row.role}') to role='dev_admin'.\n`);
    return 0;
  } finally {
    client.close();
  }
}

const exitCode = run(process.argv.slice(2));
process.exit(exitCode);
