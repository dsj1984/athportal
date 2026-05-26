#!/usr/bin/env node
// packages/shared/scripts/reset.mjs
//
// CLI entry point for `pnpm db:reset` (root) and
// `pnpm --filter @repo/shared run db:reset` (workspace-scoped).
//
// Deletes the local SQLite file at packages/shared/data/local.db,
// re-applies every migration under packages/shared/src/db/migrations/,
// and then invokes the seed CLI to repopulate the legal-documents and
// persona-graph rows. Mirrors the migrate-on-first-run path in
// scripts/dev-preflight.mjs so the same migration application logic
// runs in both places.
//
// Safety guard — refuses to operate when the resolved DB path is not
// under packages/shared/data/ (see seedPath.mjs § assertLocalDbPath).
// This is the destructive entry point in the seed harness, so the
// guard fires before any unlink runs. Story #875 / Task #885.

import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { applySeed } from './seed.mjs';
import { assertLocalDbPath, resolveLocalDbPath } from './seedPath.mjs';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolvePath(dirname(__filename), '..', '..', '..');
const MIGRATIONS_DIR = resolvePath(REPO_ROOT, 'packages/shared/src/db/migrations');

function applyMigrations(client) {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    for (const stmt of sql.split('--> statement-breakpoint').map((s) => s.trim())) {
      if (stmt.length > 0) client.exec(stmt);
    }
    console.log(`[db:reset]   applied ${file}`);
  }
}

async function main() {
  const resolved = resolveLocalDbPath({ env: process.env, repoRoot: REPO_ROOT });
  assertLocalDbPath(resolved, { repoRoot: REPO_ROOT });

  const dbDir = dirname(resolved);
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
    console.log(`[db:reset] created ${dbDir}`);
  }

  if (existsSync(resolved)) {
    unlinkSync(resolved);
    console.log(`[db:reset] removed ${resolved}`);
  }

  const client = new Database(resolved);
  client.pragma('foreign_keys = ON');
  try {
    applyMigrations(client);
    applySeed(client);
  } finally {
    client.close();
  }

  console.log(`[db:reset] reset + migrated + seeded ${resolved}`);
}

main().catch((err) => {
  console.error(`[db:reset] ${err?.message ?? err}`);
  process.exit(1);
});
