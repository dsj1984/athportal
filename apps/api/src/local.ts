// apps/api/src/local.ts
//
// Node-only dev entrypoint for `@repo/api` (Story #760).
//
// The Cloudflare-Workers-shaped `app` in `./index.ts` exports
// `app.fetch` for Workers runtimes. Local dev cannot use Wrangler
// because the persistence layer is `better-sqlite3` — a native binding
// that the Workers V8 isolate cannot load. So we serve the same `app`
// from Node via `@hono/node-server` and inject the bindings (Clerk
// secrets, a Drizzle handle over a local SQLite file) at request time.
//
// The Workers entrypoint that lands with Epic #27 will inject the same
// bindings differently — `DB` will be a per-request `@libsql/client`
// Drizzle handle built from `c.env.DATABASE_URL`. The shape of
// `c.env` (declared in `./env.ts`) stays identical across both hosts;
// the host-specific construction lives here and in the future Workers
// entrypoint.
//
// Run:
//
//   pnpm --filter @repo/api dev          # this file, via tsx watch
//   pnpm dev                              # root orchestrator
//
// The root orchestrator runs `scripts/dev-preflight.mjs` first so the
// local SQLite file is materialized before this process boots.

import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { Env } from './env';
import { app } from './index';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '../../..');
const MIGRATIONS_DIR = join(REPO_ROOT, 'packages', 'shared', 'src', 'db', 'migrations');
const DEFAULT_DB_PATH = join(REPO_ROOT, 'packages', 'shared', 'data', 'local.db');

// Load the root .env so this entrypoint runs standalone (the root
// `pnpm dev` orchestrator's preflight already validated the file, but
// turbo's child processes do not inherit env mutations from the
// orchestrator — each process loads .env itself).
function loadRootEnv(): void {
  const file = join(REPO_ROOT, '.env');
  if (!existsSync(file)) return;
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
loadRootEnv();

const PORT = Number.parseInt(process.env.PORT ?? '8787', 10);

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(
      `apps/api/local.ts: required env var ${name} is missing. Run \`pnpm dev\` from the repo root (it runs the preflight check) or populate \`.env\` per \`.env.example\`.`,
    );
  }
  return value;
}

function resolveDbFile(): string {
  // `DATABASE_URL=file:packages/shared/data/local.db` → strip the
  // `file:` prefix and resolve relative to the repo root. Anything
  // other than `file:` is rejected here because the Node host cannot
  // open a libsql HTTP URL — Epic #27 carries that.
  const url = process.env.DATABASE_URL ?? `file:${DEFAULT_DB_PATH}`;
  if (!url.startsWith('file:')) {
    throw new Error(
      `apps/api/local.ts: DATABASE_URL must start with \`file:\` for local dev (got \`${url.split(':')[0]}://…\`). Libsql/HTTP DB clients land with Epic #27.`,
    );
  }
  const stripped = url.slice('file:'.length);
  return resolve(REPO_ROOT, stripped);
}

function applyMigrationsIfEmpty(client: Database.Database): void {
  // Check whether any user tables exist. An empty SQLite file has no
  // `sqlite_master` rows of type `table` other than internal ones.
  const row = client
    .prepare(
      "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
    )
    .get() as { n: number };
  if (row.n > 0) return;

  console.log('[api/local] empty DB detected — applying migrations…');
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    for (const stmt of sql.split('--> statement-breakpoint').map((s) => s.trim())) {
      if (stmt.length > 0) client.exec(stmt);
    }
    console.log(`[api/local]   applied ${file}`);
  }
}

function openDb(): unknown {
  const file = resolveDbFile();
  mkdirSync(dirname(file), { recursive: true });
  const client = new Database(file);
  client.pragma('foreign_keys = ON');
  applyMigrationsIfEmpty(client);
  return drizzle(client, { schema: {} });
}

const dbHandle = openDb();

// Stub the Analytics Engine binding the request-completion middleware
// expects — local dev does not ship to Cloudflare's pipeline.
const analyticsStub = {
  writeDataPoint: () => undefined,
};

const bindings: Env = {
  ANALYTICS: analyticsStub,
  RUNTIME_ENV: 'development',
  RELEASE_SHA: process.env.RELEASE_SHA ?? 'local',
  CLERK_SECRET_KEY: requireEnv('CLERK_SECRET_KEY'),
  CLERK_PUBLISHABLE_KEY: requireEnv('CLERK_PUBLISHABLE_KEY'),
  CLERK_WEBHOOK_SIGNING_SECRET: process.env.CLERK_WEBHOOK_SECRET ?? '',
  DB: dbHandle,
  DATABASE_URL: process.env.DATABASE_URL ?? `file:${DEFAULT_DB_PATH}`,
};

serve(
  {
    fetch: (req) => app.fetch(req, bindings),
    port: PORT,
  },
  (info) => {
    console.log(`[api/local] listening on http://localhost:${String(info.port)}`);
  },
);
