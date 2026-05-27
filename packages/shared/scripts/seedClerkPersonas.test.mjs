// packages/shared/scripts/seedClerkPersonas.test.mjs
//
// Contract test for `packages/shared/scripts/seed.mjs § applySeed` —
// pins that the operator's runtime DB (after `pnpm db:seed`) carries
// the **real** Clerk subject IDs from
// `packages/shared/src/testing/clerk-personas.json`, not the
// `user_test_*` placeholders the TS-side `seedFixtures.ts` writes for
// the unit-test surface.
//
// Story #942 — closes the gap discovered during the Epic #11 manual-QA
// walkthrough on PR #940. The TS-side `seedFixtures()` is intentionally
// stub-only for deterministic contract testing; the CLI path is where
// the operator's real Clerk session must find a matching `users` row.
//
// Skip policy. The test is `it.skipIf(SKIP)`-gated on the personas
// JSON being populated with non-empty `user_*` strings — same gate
// the integration test for `mintSignInTicket` uses
// (`packages/shared/src/testing/clerkTickets.integration.test.ts`).
// CI with the JSON populated runs the assertion; a fresh-checkout
// developer with placeholder values does not see a failure.
//
// Tier: contract. We exercise the wire boundary between the CLI seed
// and the SQLite schema (real DB + real applySeed + DB-state
// assertion).

import { readFileSync } from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { applySeed } from './seed.mjs';

const __filename = fileURLToPath(import.meta.url);
const SHARED_DIR = resolvePath(dirname(__filename), '..');
const PERSONAS_JSON_PATH = join(SHARED_DIR, 'src', 'testing', 'clerk-personas.json');
const MIGRATIONS_DIR = join(SHARED_DIR, 'src', 'db', 'migrations');

const FIXTURE_MIGRATIONS = [
  '0000_auth_and_rbac.sql',
  '0001_onboarding_schema.sql',
  '0002_org_team_graph.sql',
  '0003_invitations.sql',
  '0004_org_branding.sql',
  '0005_team_metadata.sql',
  '0006_csv_import_batches.sql',
  '0007_roster.sql',
];

/**
 * Read the on-disk persona JSON without going through the seed's own
 * resolver. We want this test's skip gate to inspect the raw file
 * contents, not the seed function's error envelope, so a CI run with
 * an unpopulated JSON skips silently (matches the existing
 * `mintSignInTicket` integration-test policy).
 */
function readPersonasFromDisk() {
  try {
    const raw = JSON.parse(readFileSync(PERSONAS_JSON_PATH, 'utf8'));
    return {
      athlete: raw.athlete,
      coach: raw.coach,
      'org-admin': raw['org-admin'],
    };
  } catch {
    return null;
  }
}

function isPopulated(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.startsWith('user_');
}

const personas = readPersonasFromDisk();
const SKIP =
  personas === null ||
  !isPopulated(personas.athlete) ||
  !isPopulated(personas.coach) ||
  !isPopulated(personas['org-admin']);

function loadMigration(filename) {
  return readFileSync(join(MIGRATIONS_DIR, filename), 'utf8');
}

function applyMigration(client, sql) {
  const statements = sql
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const stmt of statements) {
    client.exec(stmt);
  }
}

function freshDb() {
  const client = new Database(':memory:');
  client.pragma('foreign_keys = ON');
  for (const filename of FIXTURE_MIGRATIONS) {
    applyMigration(client, loadMigration(filename));
  }
  return client;
}

describe('seed.mjs applySeed — Clerk persona mapping (Story #942)', () => {
  it.skipIf(SKIP)(
    'writes the real coach Clerk subject ID from clerk-personas.json into users.clerk_subject_id',
    () => {
      const db = freshDb();
      try {
        applySeed(db);

        const coachRow = db
          .prepare('SELECT clerk_subject_id FROM users WHERE id = ?')
          .get('user_seed_coach');

        expect(coachRow).toBeDefined();
        expect(coachRow.clerk_subject_id).toBe(personas.coach);
        // Sanity: not a `user_test_*` fallback. If this fires the
        // resolver silently fell back instead of using the JSON.
        expect(coachRow.clerk_subject_id).not.toMatch(/^user_test_/);
      } finally {
        db.close();
      }
    },
  );

  it.skipIf(SKIP)('maps every persona (athlete / coach / org-admin) to its real subject ID', () => {
    const db = freshDb();
    try {
      applySeed(db);

      const select = db.prepare('SELECT clerk_subject_id FROM users WHERE id = ?');
      const athlete = select.get('user_seed_athlete');
      const coach = select.get('user_seed_coach');
      const orgAdmin = select.get('user_seed_org_admin');

      expect(athlete?.clerk_subject_id).toBe(personas.athlete);
      expect(coach?.clerk_subject_id).toBe(personas.coach);
      expect(orgAdmin?.clerk_subject_id).toBe(personas['org-admin']);
    } finally {
      db.close();
    }
  });
});
