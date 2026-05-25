#!/usr/bin/env node
// scripts/dev-preflight.mjs
//
// Verifies that the local-dev environment is wired up before `pnpm dev`
// spawns the api + web processes. Exits non-zero with a punch list when
// any required prerequisite is missing — no silent fallbacks.
//
// Checks:
//   1. `.env` is present at the repo root.
//   2. The keys named in REQUIRED_ENV_VARS are populated (non-empty).
//   3. The local SQLite file exists. If absent, create the parent
//      directory + the file and apply every migration under
//      `packages/shared/src/db/migrations/`.
//
// Story #760.

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Minimal `.env` parser — handles `KEY=value` lines, `#` comments, and
 * blank lines. Quoted values keep their quote characters stripped.
 * Avoids dragging `dotenv` into the root dev-tool surface for one read.
 */
function loadEnvFile(file) {
  const text = readFileSync(file, 'utf8');
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const ENV_FILE = join(REPO_ROOT, '.env');
const MIGRATIONS_DIR = join(REPO_ROOT, 'packages', 'shared', 'src', 'db', 'migrations');
const DEFAULT_DB_FILE = join(REPO_ROOT, 'packages', 'shared', 'data', 'local.db');

const REQUIRED_ENV_VARS = [
  'CLERK_SECRET_KEY',
  'CLERK_PUBLISHABLE_KEY',
  'PUBLIC_CLERK_PUBLISHABLE_KEY',
  'PUBLIC_API_URL',
  'DATABASE_URL',
];

const failures = [];

if (!existsSync(ENV_FILE)) {
  failures.push(
    `.env is missing at ${ENV_FILE}. Copy .env.example to .env and populate the required keys.`,
  );
} else {
  // Surface root-level keys to the current process so the checks below
  // and the spawned dev servers see the same values.
  loadEnvFile(ENV_FILE);
}

for (const name of REQUIRED_ENV_VARS) {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    failures.push(`env var ${name} is not set (required by api or web at startup).`);
  }
}

function resolveDbFile() {
  const url = process.env.DATABASE_URL ?? `file:${DEFAULT_DB_FILE}`;
  if (!url.startsWith('file:')) {
    failures.push(
      `DATABASE_URL must use the \`file:\` scheme for local dev (got \`${url.split(':')[0]}://…\`). Libsql/HTTP wiring lands with Epic #27.`,
    );
    return null;
  }
  return resolve(REPO_ROOT, url.slice('file:'.length));
}

const dbFile = resolveDbFile();

if (dbFile !== null) {
  const dbDir = dirname(dbFile);
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
    console.log(`[dev-preflight] created ${dbDir}`);
  }
  if (!existsSync(dbFile)) {
    console.log(`[dev-preflight] ${dbFile} not found — creating + applying migrations…`);
    try {
      // Use a one-shot child process so we don't need to bring
      // better-sqlite3 into this script's import surface (avoids
      // forcing a native rebuild when the script runs in CI).
      const initScript = `
        const Database = require('better-sqlite3');
        const fs = require('node:fs');
        const path = require('node:path');
        const db = new Database(${JSON.stringify(dbFile)});
        db.pragma('foreign_keys = ON');
        const dir = ${JSON.stringify(MIGRATIONS_DIR)};
        const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
        for (const file of files) {
          const sql = fs.readFileSync(path.join(dir, file), 'utf8');
          for (const stmt of sql.split('--> statement-breakpoint').map((s) => s.trim())) {
            if (stmt.length > 0) db.exec(stmt);
          }
          console.log('[dev-preflight]   applied ' + file);
        }
        db.close();
      `;
      execSync(`node -e ${JSON.stringify(initScript)}`, {
        cwd: REPO_ROOT,
        stdio: 'inherit',
      });
    } catch (err) {
      failures.push(`failed to initialize local DB at ${dbFile}: ${err?.message ?? err}`);
    }
  }
}

if (failures.length > 0) {
  console.error('\n✗ dev-preflight: prerequisites missing\n');
  for (const line of failures) {
    console.error(`  - ${line}`);
  }
  console.error('\nSee .env.example for the full env-var contract.\n');
  process.exit(1);
}

console.log('✓ dev-preflight: environment ready');
