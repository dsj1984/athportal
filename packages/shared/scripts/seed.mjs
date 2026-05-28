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

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import { assertLocalDbPath, resolveLocalDbPath } from './seedPath.mjs';

/**
 * Resolve persona Clerk subject IDs from the tracked
 * `src/testing/clerk-personas.json` file.
 *
 * Resolution policy (Story #942):
 *   1. **File missing entirely** → fall back to synthetic
 *      `user_test_*` placeholders. A fresh checkout / CI run without
 *      the JSON file still seeds a runnable persona graph, so first-
 *      time bootstrap and CI smoke flows are not blocked.
 *   2. **File present + every persona populated with a non-empty
 *      `user_*` string** → return the real IDs.
 *   3. **File present but one or more personas are `null` / empty /
 *      non-string** → throw a runbook-linked error. This is the
 *      "operator started the bootstrap but did not finish it" path —
 *      silently writing stubs leaves the DB in a state where the
 *      operator's real Clerk session cannot find the corresponding
 *      `users` row, which is exactly what Story #942 fixes.
 *
 * Reads via `fs.readFileSync` instead of importing the TS reader
 * (`src/testing/clerkPersonas.ts`) because this is a `.mjs` Node
 * entry point and per the architecture rule no production code
 * imports from `src/testing/**` anyway.
 */
function resolveClerkSubjectIds() {
  const fallbacks = {
    athlete: 'user_test_athlete',
    coach: 'user_test_coach',
    'org-admin': 'user_test_org_admin',
  };
  const __filename = fileURLToPath(import.meta.url);
  const personasPath = resolvePath(
    dirname(__filename),
    '..',
    'src',
    'testing',
    'clerk-personas.json',
  );
  if (!existsSync(personasPath)) return fallbacks;

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(personasPath, 'utf8'));
  } catch (cause) {
    throw new Error(
      `seed: ${personasPath} is not valid JSON. ` +
        `Restore it from git or follow docs/runbooks/clerk-persona-bootstrap.md ` +
        `to recreate it.`,
      { cause },
    );
  }

  const personas = ['athlete', 'coach', 'org-admin'];
  const missing = personas.filter((p) => {
    const value = parsed?.[p];
    return typeof value !== 'string' || value.trim().length === 0;
  });
  if (missing.length > 0) {
    const list = missing.map((p) => `'${p}'`).join(', ');
    throw new Error(
      `seed: the following persona(s) are not yet populated in ${personasPath}: ${list}. ` +
        `Follow docs/runbooks/clerk-persona-bootstrap.md to create the corresponding ` +
        `Clerk users in the test instance and paste each user's subject ID into the JSON ` +
        `file, then re-run \`pnpm db:reset && pnpm db:seed\` so the seeded \`users\` rows ` +
        `carry your real Clerk persona subject IDs.`,
    );
  }

  return {
    athlete: parsed.athlete,
    coach: parsed.coach,
    'org-admin': parsed['org-admin'],
  };
}

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
// Story #986 — second same-org team, second org + team, for the
// multi-team / multi-org QA Plans (F31 + F36). Mirror of the constants
// in src/db/seedFixtures.ts.
const SEED_ORG_B_ID = 'org_test_b';
const SEED_TEAM_A2_ID = 'team_test_a_2';
const SEED_TEAM_B1_ID = 'team_test_b_1';
// Clerk subject IDs are resolved at runtime from
// src/testing/clerk-personas.json (when populated by the operator
// per docs/runbooks/clerk-persona-bootstrap.md) — otherwise fall back
// to the synthetic `user_test_*` placeholders.
const CLERK_SUBJECT_IDS = resolveClerkSubjectIds();
const SEED_USERS = [
  {
    id: 'user_seed_athlete',
    clerkSubjectId: CLERK_SUBJECT_IDS.athlete,
    email: 'athlete@example.com',
    role: 'member',
    orgId: SEED_ORG_ID,
    teamId: null,
  },
  {
    id: 'user_seed_coach',
    clerkSubjectId: CLERK_SUBJECT_IDS.coach,
    email: 'coach@example.com',
    role: 'team_admin',
    orgId: SEED_ORG_ID,
    teamId: SEED_TEAM_ID,
  },
  {
    id: 'user_seed_org_admin',
    clerkSubjectId: CLERK_SUBJECT_IDS['org-admin'],
    email: 'org-admin@example.com',
    role: 'org_admin',
    orgId: SEED_ORG_ID,
    teamId: null,
  },
  // Story #986 — extra athletes (synthetic subjects, not Clerk personas).
  {
    id: 'user_seed_athlete_b',
    clerkSubjectId: 'user_test_athlete_b',
    email: 'b@example.com',
    role: 'member',
    orgId: SEED_ORG_ID,
    teamId: null,
  },
  {
    id: 'user_seed_athlete_a2',
    clerkSubjectId: 'user_test_athlete_a2',
    email: 'a2@example.com',
    role: 'member',
    orgId: SEED_ORG_ID,
    teamId: null,
  },
  {
    id: 'user_seed_athlete_b1',
    clerkSubjectId: 'user_test_athlete_b1',
    email: 'b1@example.com',
    role: 'member',
    orgId: SEED_ORG_B_ID,
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

  // Organizations. Story #986 adds org_test_b for the cross-org Plan.
  const insertOrg = client.prepare(
    `INSERT INTO organizations (id, name, organization_type)
     VALUES (?, ?, ?)
     ON CONFLICT(id) DO NOTHING`,
  );
  insertOrg.run(SEED_ORG_ID, 'Seeded Test Organization A', 'CLUB');
  insertOrg.run(SEED_ORG_B_ID, 'Seeded Test Organization B', 'CLUB');

  // Teams — must land before users because users.team_id FKs to teams.id
  // and the coach persona carries a non-null team_id. Story #986 adds a
  // second same-org team (team_test_a_2) and an other-org team
  // (team_test_b_1).
  const insertTeam = client.prepare(
    `INSERT INTO teams (id, org_id, name, sport, season, age_group)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO NOTHING`,
  );
  insertTeam.run(SEED_TEAM_ID, SEED_ORG_ID, 'Seeded Test Team A1', 'soccer', '2026', 'U14');
  insertTeam.run(SEED_TEAM_A2_ID, SEED_ORG_ID, 'Seeded Test Team A2', 'basketball', '2026', 'U16');
  insertTeam.run(
    SEED_TEAM_B1_ID,
    SEED_ORG_B_ID,
    'Seeded Test Team B1',
    'volleyball',
    '2026',
    'U16',
  );

  // Persona + Story #986 athlete users. `org_id` is per-user so the
  // other-org athlete (user_seed_athlete_b1) lands in org_test_b.
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
      user.orgId,
      user.teamId,
      SEED_BOOTSTRAP_EFFECTIVE_AT_UNIX,
    );
  }

  // Athlete memberships. Story #986 adds the F31 control-row athlete on
  // the coach's team plus the F36 cross-team / cross-org athletes.
  const insertMembership = client.prepare(
    `INSERT INTO athlete_memberships (id, org_id, team_id, athlete_user_id)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO NOTHING`,
  );
  insertMembership.run('am_seed_athlete', SEED_ORG_ID, SEED_TEAM_ID, 'user_seed_athlete');
  insertMembership.run('am_seed_athlete_b', SEED_ORG_ID, SEED_TEAM_ID, 'user_seed_athlete_b');
  insertMembership.run('am_seed_athlete_a2', SEED_ORG_ID, SEED_TEAM_A2_ID, 'user_seed_athlete_a2');
  insertMembership.run(
    'am_seed_athlete_b1',
    SEED_ORG_B_ID,
    SEED_TEAM_B1_ID,
    'user_seed_athlete_b1',
  );

  client
    .prepare(
      `INSERT INTO coach_assignments (id, org_id, team_id, coach_user_id)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO NOTHING`,
    )
    .run('ca_seed_coach', SEED_ORG_ID, SEED_TEAM_ID, 'user_seed_coach');

  // Roster entry — the coach roster surface (Epic #11) reads from
  // `roster_entry` exclusively. Mirrors the row written by
  // `src/db/seedFixtures.ts § seedFixtures`; PR #940 added the row to
  // the TS module but not to this script, leaving the runtime seed
  // unable to populate the coach roster page. Story #981.
  const insertRosterEntry = client.prepare(
    `INSERT INTO roster_entry (
       id, org_id, team_id, athlete_user_id,
       jersey_number, primary_position, ended_at,
       created_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO NOTHING`,
  );
  insertRosterEntry.run(
    're_seed_athlete',
    SEED_ORG_ID,
    SEED_TEAM_ID,
    'user_seed_athlete',
    '10',
    'Forward',
    null,
    SEED_BOOTSTRAP_EFFECTIVE_AT_UNIX,
    SEED_BOOTSTRAP_EFFECTIVE_AT_UNIX,
  );
  // Story #986 — F31 control row on the coach's team.
  insertRosterEntry.run(
    're_seed_athlete_b',
    SEED_ORG_ID,
    SEED_TEAM_ID,
    'user_seed_athlete_b',
    '7',
    'Goalkeeper',
    null,
    SEED_BOOTSTRAP_EFFECTIVE_AT_UNIX,
    SEED_BOOTSTRAP_EFFECTIVE_AT_UNIX,
  );
  // Story #986 — F36 second same-org team roster entry.
  insertRosterEntry.run(
    're_seed_athlete_a2',
    SEED_ORG_ID,
    SEED_TEAM_A2_ID,
    'user_seed_athlete_a2',
    '22',
    'Center',
    null,
    SEED_BOOTSTRAP_EFFECTIVE_AT_UNIX,
    SEED_BOOTSTRAP_EFFECTIVE_AT_UNIX,
  );
  // Story #986 — F36 other-org team roster entry.
  insertRosterEntry.run(
    're_seed_athlete_b1',
    SEED_ORG_B_ID,
    SEED_TEAM_B1_ID,
    'user_seed_athlete_b1',
    '11',
    'Setter',
    null,
    SEED_BOOTSTRAP_EFFECTIVE_AT_UNIX,
    SEED_BOOTSTRAP_EFFECTIVE_AT_UNIX,
  );
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
