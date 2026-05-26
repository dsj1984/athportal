#!/usr/bin/env node
// packages/shared/scripts/seed.mjs
//
// CLI entry point for `pnpm db:seed` (root) and
// `pnpm --filter @repo/shared run db:seed` (workspace-scoped).
//
// Opens the local SQLite file at packages/shared/data/local.db (or
// whatever DATABASE_URL points at, provided it stays under that
// directory — see `seedPath.mjs § assertLocalDbPath`), applies the
// legal-documents seed then the persona-graph fixture seed, and exits 0.
//
// The seed contents mirror the Drizzle `seedLegalDocuments` and
// `seedFixtures` exports at packages/shared/src/db/seed.ts and
// packages/shared/src/db/seedFixtures.ts respectively. Those TS modules
// remain the single source of truth for the schema-level inserter; this
// script duplicates the row literals because a plain `.mjs` Node entry
// point cannot import relative `.ts` files without a transpiler (same
// constraint scripts/seed-dev-admin.mjs documents). If the row shape
// changes, update both files in the same PR — the unit test
// `packages/shared/src/db/seedFixtures.test.ts` pins the TS-level
// contract.
//
// Idempotent — every insert uses SQLite's `INSERT … ON CONFLICT DO
// NOTHING` clause on the primary key, so running the script twice
// produces no duplicate rows. Story #875 / Task #885.

import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertLocalDbPath, resolveLocalDbPath } from './seedPath.mjs';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolvePath(dirname(__filename), '..', '..', '..');

// ---------------------------------------------------------------------------
// Seed constants (mirror src/db/seed.ts + src/db/seedFixtures.ts)
// ---------------------------------------------------------------------------

// SEED_BOOTSTRAP_EFFECTIVE_AT — pinned ISO date so re-runs are byte-stable.
// Mirrors the constant exported from src/db/seed.ts.
const SEED_BOOTSTRAP_EFFECTIVE_AT_UNIX = Math.floor(
  new Date('2026-01-01T00:00:00.000Z').getTime() / 1000,
);

// Legal-documents seed (mirrors src/db/seed.ts § seedLegalDocuments).
const LEGAL_DOCUMENTS = [
  {
    id: 'seed_tos_2026_01_01',
    kind: 'terms_of_service',
    version: '2026-01-01',
    bodyUrl: 'https://athportal.example.invalid/legal/terms-of-service/2026-01-01',
  },
  {
    id: 'seed_privacy_2026_01_01',
    kind: 'privacy_policy',
    version: '2026-01-01',
    bodyUrl: 'https://athportal.example.invalid/legal/privacy-policy/2026-01-01',
  },
];

// Persona-graph seed (mirrors src/db/seedFixtures.ts § seedFixtures).
const SEED_ORG_ID = 'org_test_a';
const SEED_TEAM_ID = 'team_test_a_1';
const SEED_USERS = [
  {
    id: 'user_seed_athlete',
    clerkSubjectId: 'user_test_athlete',
    email: 'athlete@example.com',
    role: 'member',
    teamId: null,
  },
  {
    id: 'user_seed_coach',
    clerkSubjectId: 'user_test_coach',
    email: 'coach@example.com',
    role: 'team_admin',
    teamId: SEED_TEAM_ID,
  },
  {
    id: 'user_seed_org_admin',
    clerkSubjectId: 'user_test_org_admin',
    email: 'org-admin@example.com',
    role: 'org_admin',
    teamId: null,
  },
];

/**
 * Apply both seed batches against an open `better-sqlite3` Database
 * handle. Each prepared statement uses `INSERT … ON CONFLICT DO
 * NOTHING` so the function is idempotent on re-run.
 *
 * Insert order matters because of FK constraints:
 *   organizations → teams → users → athlete_memberships
 *                                 → coach_assignments
 */
export function applySeed(client) {
  // Legal documents (no FK dependencies on the seeded rows).
  const insertLegalDoc = client.prepare(
    `INSERT INTO legal_documents (id, kind, version, effective_at, body_url)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO NOTHING`,
  );
  for (const doc of LEGAL_DOCUMENTS) {
    insertLegalDoc.run(
      doc.id,
      doc.kind,
      doc.version,
      SEED_BOOTSTRAP_EFFECTIVE_AT_UNIX,
      doc.bodyUrl,
    );
  }

  // Organization.
  client
    .prepare(
      `INSERT INTO organizations (id, name, organization_type)
       VALUES (?, ?, ?)
       ON CONFLICT(id) DO NOTHING`,
    )
    .run(SEED_ORG_ID, 'Seeded Test Organization A', 'CLUB');

  // Team — must land before users because users.team_id FKs to teams.id
  // and the coach persona carries a non-null team_id.
  client
    .prepare(
      `INSERT INTO teams (id, org_id, name, sport, season, age_group)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO NOTHING`,
    )
    .run(SEED_TEAM_ID, SEED_ORG_ID, 'Seeded Test Team A1', 'soccer', '2026', 'U14');

  // Persona users.
  const insertUser = client.prepare(
    `INSERT INTO users (id, clerk_subject_id, email, role, org_id, team_id, onboarded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO NOTHING`,
  );
  for (const user of SEED_USERS) {
    insertUser.run(
      user.id,
      user.clerkSubjectId,
      user.email,
      user.role,
      SEED_ORG_ID,
      user.teamId,
      SEED_BOOTSTRAP_EFFECTIVE_AT_UNIX,
    );
  }

  // Athlete membership + coach assignment.
  client
    .prepare(
      `INSERT INTO athlete_memberships (id, org_id, team_id, athlete_user_id)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO NOTHING`,
    )
    .run('am_seed_athlete', SEED_ORG_ID, SEED_TEAM_ID, 'user_seed_athlete');

  client
    .prepare(
      `INSERT INTO coach_assignments (id, org_id, team_id, coach_user_id)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO NOTHING`,
    )
    .run('ca_seed_coach', SEED_ORG_ID, SEED_TEAM_ID, 'user_seed_coach');
}

async function main() {
  const resolved = resolveLocalDbPath({ env: process.env, repoRoot: REPO_ROOT });
  assertLocalDbPath(resolved, { repoRoot: REPO_ROOT });

  if (!existsSync(resolved)) {
    throw new Error(
      `seed.mjs: local SQLite file does not exist at ${resolved}. ` +
        'Run `pnpm dev` once (which triggers scripts/dev-preflight.mjs to create ' +
        'and migrate the file), or run `pnpm db:reset` to create + migrate + seed in one step.',
    );
  }

  const client = new Database(resolved);
  client.pragma('foreign_keys = ON');
  try {
    applySeed(client);
  } finally {
    client.close();
  }

  console.log(`[db:seed] applied legal-documents + persona-graph seeds to ${resolved}`);
}

// Only run when invoked directly (not when imported by reset.mjs or the
// test file). `pathToFileURL` from node:url is the canonical way to map
// the absolute path Node hands to `process.argv[1]` into the same shape
// `import.meta.url` carries (handles Windows drive letters + URL escaping).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`[db:seed] ${err?.message ?? err}`);
    process.exit(1);
  });
}
