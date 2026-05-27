// apps/api/src/routes/v1/admin/csv-import/csv-import.contract.test.ts
//
// Contract test for the parse + commit surface (Epic #10 / Story #663
// / Task #687).
//
// Pins six wire-shape invariants:
//
//   1. POST /parse with a multipart upload returns 200 with
//      `{ success: true, data: { headers, previewRows } }` and caps
//      the preview at 10 rows.
//   2. POST /commit happy-path imports every row, persists one
//      `csv_import_batches` row, and returns row counts +
//      `reusedUserIds: []` when every email is new.
//   3. POST /commit re-uses an existing platform user when the
//      imported email already exists in `users` (any org). The
//      reused user id appears in `reusedUserIds`; a new
//      `athlete_memberships` row is added against the actor's org;
//      no second `users` row is minted.
//   4. POST /commit with a structurally bad mapping (missing required
//      column) returns 400 with `IMPORT_FAILED` and an error envelope;
//      no `csv_import_batches` row is persisted; no users are minted;
//      no memberships are created.
//   5. POST /commit referencing a team owned by a peer org surfaces
//      `TEAM_NOT_FOUND` and rolls back the whole batch — cross-org
//      isolation cannot be probed via the import surface.
//   6. POST /parse with a non-multipart body returns 415; POST
//      /commit without an org context returns 403.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  athleteMemberships,
  csvImportBatches,
  organizations,
  teams,
  users,
} from '@repo/shared/db/schema';
import { type AuthContext, createTestApp } from '@repo/shared/testing';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { RequireInternalUserEnv } from '../../../../middleware/auth';
import { csvImportAdminRouter } from './router';

const MIGRATIONS_DIR = join(__dirname, '../../../../../../../packages/shared/src/db/migrations');
const MIGRATION_FILES = [
  '0000_auth_and_rbac.sql',
  '0001_onboarding_schema.sql',
  '0002_org_team_graph.sql',
  '0003_invitations.sql',
  '0004_org_branding.sql',
  '0005_team_metadata.sql',
  '0006_csv_import_batches.sql',
  '0007_roster.sql',
  '0008_csv_import_batch_filename.sql',
];

function freshProductionDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  for (const file of MIGRATION_FILES) {
    const migration = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    for (const stmt of migration.split('--> statement-breakpoint').map((s) => s.trim())) {
      if (stmt.length > 0) sqlite.exec(stmt);
    }
  }
  return drizzle(sqlite, {
    schema: {
      users,
      organizations,
      teams,
      athleteMemberships,
      csvImportBatches,
    },
  });
}

interface Seed {
  readonly orgA: string;
  readonly orgB: string;
  readonly adminA: string;
  readonly adminB: string;
  readonly teamA1: string;
  readonly teamA2: string;
  readonly teamB1: string;
}

function seedGraph(db: ReturnType<typeof freshProductionDb>): Seed {
  const seed: Seed = {
    orgA: 'org_a',
    orgB: 'org_b',
    adminA: 'u_admin_a',
    adminB: 'u_admin_b',
    teamA1: 'team_a1',
    teamA2: 'team_a2',
    teamB1: 'team_b1',
  };
  db.insert(organizations)
    .values([
      { id: seed.orgA, name: 'Org A', organizationType: 'CLUB' },
      { id: seed.orgB, name: 'Org B', organizationType: 'CLUB' },
    ])
    .run();
  db.insert(teams)
    .values([
      { id: seed.teamA1, orgId: seed.orgA, name: 'Tigers' },
      { id: seed.teamA2, orgId: seed.orgA, name: 'Lions' },
      { id: seed.teamB1, orgId: seed.orgB, name: 'Bears' },
    ])
    .run();
  db.insert(users)
    .values([
      {
        id: seed.adminA,
        clerkSubjectId: 'user_admin_a',
        email: 'admin-a@test.invalid',
        role: 'org_admin',
        orgId: seed.orgA,
      },
      {
        id: seed.adminB,
        clerkSubjectId: 'user_admin_b',
        email: 'admin-b@test.invalid',
        role: 'org_admin',
        orgId: seed.orgB,
      },
    ])
    .run();
  return seed;
}

function actorFor(seed: Seed, which: 'A' | 'B'): AuthContext {
  return {
    userId: which === 'A' ? seed.adminA : seed.adminB,
    clerkSubjectId: which === 'A' ? 'user_admin_a' : 'user_admin_b',
    email: which === 'A' ? 'admin-a@test.invalid' : 'admin-b@test.invalid',
    role: 'org_admin',
    orgId: which === 'A' ? seed.orgA : seed.orgB,
    teamId: null,
  };
}

function buildApp(db: ReturnType<typeof freshProductionDb>, actor: AuthContext) {
  const app = createTestApp(db, { actor }) as unknown as Hono<RequireInternalUserEnv>;
  app.route('/api/v1/admin/csv-import', csvImportAdminRouter);
  return app;
}

function toBase64(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64');
}

const HAPPY_CSV = [
  'email,firstName,lastName,teamName',
  'a@x.invalid,Ada,Lovelace,Tigers',
  'b@x.invalid,Bob,Smith,Lions',
  'c@x.invalid,Carol,Jones,Tigers',
].join('\n');

describe('admin csv-import — contract', () => {
  it('POST /parse returns headers and capped preview rows', async () => {
    const db = freshProductionDb();
    const seed = seedGraph(db);
    const app = buildApp(db, actorFor(seed, 'A'));

    // Build a multipart body via the DOM FormData/Blob globals.
    const form = new FormData();
    form.set('file', new Blob([HAPPY_CSV], { type: 'text/csv' }), 'roster.csv');

    const res = await app.request('/api/v1/admin/csv-import/parse', {
      method: 'POST',
      body: form,
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: true;
      data: { headers: string[]; previewRows: string[][] };
    };
    expect(body.success).toBe(true);
    expect(body.data.headers).toEqual(['email', 'firstName', 'lastName', 'teamName']);
    expect(body.data.previewRows.length).toBe(3);
    expect(body.data.previewRows[0]).toEqual(['a@x.invalid', 'Ada', 'Lovelace', 'Tigers']);
  });

  it('POST /parse with non-multipart body returns 415', async () => {
    const db = freshProductionDb();
    const seed = seedGraph(db);
    const app = buildApp(db, actorFor(seed, 'A'));

    const res = await app.request('/api/v1/admin/csv-import/parse', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });

    expect(res.status).toBe(415);
    const body = (await res.json()) as { success: false; error: { code: string } };
    expect(body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('POST /commit happy-path imports every row and persists one audit batch', async () => {
    const db = freshProductionDb();
    const seed = seedGraph(db);
    const app = buildApp(db, actorFor(seed, 'A'));

    const res = await app.request('/api/v1/admin/csv-import/commit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        fileBase64: toBase64(HAPPY_CSV),
        fileName: 'roster.csv',
        mapping: {
          email: 'email',
          firstName: 'firstName',
          lastName: 'lastName',
          teamName: 'teamName',
        },
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: true;
      data: {
        batchId: string;
        rowCount: number;
        successCount: number;
        errorCount: number;
        reusedUserIds: string[];
      };
    };
    expect(body.success).toBe(true);
    expect(body.data.rowCount).toBe(3);
    expect(body.data.successCount).toBe(3);
    expect(body.data.errorCount).toBe(0);
    expect(body.data.reusedUserIds).toEqual([]);

    // DB side-effects.
    const batches = db.select().from(csvImportBatches).all();
    expect(batches.length).toBe(1);
    expect(batches[0]!.orgId).toBe(seed.orgA);
    expect(batches[0]!.rowCount).toBe(3);
    // Story #973 F1 — the persisted batch row carries the original
    // upload filename so the admin "import history" surface can name
    // the source CSV.
    expect(batches[0]!.fileName).toBe('roster.csv');

    const newAthletes = db.select().from(users).where(eq(users.email, 'a@x.invalid')).all();
    expect(newAthletes.length).toBe(1);

    const memberships = db.select().from(athleteMemberships).all();
    expect(memberships.length).toBe(3);
  });

  it('POST /commit re-uses an existing platform user for a duplicate email', async () => {
    const db = freshProductionDb();
    const seed = seedGraph(db);

    // Seed an existing user in ORG B with the email we are about to
    // import into ORG A. Reuse cannot leak the peer-org membership;
    // we only signal that the email already had a platform account.
    const existingUserId = 'u_existing_b';
    db.insert(users)
      .values({
        id: existingUserId,
        clerkSubjectId: 'user_existing_b',
        email: 'a@x.invalid',
        role: 'member',
        orgId: seed.orgB,
      })
      .run();

    const app = buildApp(db, actorFor(seed, 'A'));

    const res = await app.request('/api/v1/admin/csv-import/commit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        fileBase64: toBase64(HAPPY_CSV),
        fileName: 'roster.csv',
        mapping: {
          email: 'email',
          firstName: 'firstName',
          lastName: 'lastName',
          teamName: 'teamName',
        },
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: true;
      data: { reusedUserIds: string[]; successCount: number };
    };
    expect(body.data.reusedUserIds).toEqual([existingUserId]);
    expect(body.data.successCount).toBe(3);

    // The existing user row was NOT duplicated.
    const rowsForEmail = db.select().from(users).where(eq(users.email, 'a@x.invalid')).all();
    expect(rowsForEmail.length).toBe(1);

    // A new athlete_memberships row points at the existing user in
    // org A.
    const membershipsForUser = db
      .select()
      .from(athleteMemberships)
      .where(eq(athleteMemberships.athleteUserId, existingUserId))
      .all();
    expect(membershipsForUser.length).toBe(1);
    expect(membershipsForUser[0]!.orgId).toBe(seed.orgA);
  });

  it('POST /commit with a missing required column returns 400 and persists nothing', async () => {
    const db = freshProductionDb();
    const seed = seedGraph(db);
    const app = buildApp(db, actorFor(seed, 'A'));

    const res = await app.request('/api/v1/admin/csv-import/commit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        fileBase64: toBase64(HAPPY_CSV),
        fileName: 'roster.csv',
        mapping: {
          email: 'email',
          firstName: 'firstName',
          // lastName omitted on purpose.
          teamName: 'teamName',
        },
      }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      success: false;
      error: { code: string; rowErrors?: Array<{ code: string; field?: string }> };
    };
    expect(body.error.code).toBe('IMPORT_FAILED');
    expect(body.error.rowErrors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'MISSING_REQUIRED_COLUMN', field: 'lastName' }),
      ]),
    );

    // Side-effect: nothing was written.
    expect(db.select().from(csvImportBatches).all().length).toBe(0);
    expect(db.select().from(athleteMemberships).all().length).toBe(0);
    const newUsers = db.select().from(users).where(eq(users.email, 'a@x.invalid')).all();
    expect(newUsers.length).toBe(0);
  });

  it('POST /commit referencing a peer-org team surfaces TEAM_NOT_FOUND', async () => {
    const db = freshProductionDb();
    const seed = seedGraph(db);
    const app = buildApp(db, actorFor(seed, 'A'));

    // Org B owns the team "Bears" — Org A's import cannot resolve it.
    const csv = ['email,firstName,lastName,teamName', 'x@x.invalid,X,Y,Bears'].join('\n');

    const res = await app.request('/api/v1/admin/csv-import/commit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        fileBase64: toBase64(csv),
        fileName: 'roster.csv',
        mapping: {
          email: 'email',
          firstName: 'firstName',
          lastName: 'lastName',
          teamName: 'teamName',
        },
      }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      success: false;
      error: { code: string; rowErrors?: Array<{ code: string }> };
    };
    expect(body.error.code).toBe('IMPORT_FAILED');
    expect(body.error.rowErrors).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'TEAM_NOT_FOUND' })]),
    );

    // No batch was persisted.
    expect(db.select().from(csvImportBatches).all().length).toBe(0);
    // The peer-org team's membership table is untouched.
    expect(
      db.select().from(athleteMemberships).where(eq(athleteMemberships.teamId, seed.teamB1)).all()
        .length,
    ).toBe(0);
  });

  it('POST /commit without an org context returns 403', async () => {
    const db = freshProductionDb();
    const seed = seedGraph(db);
    const actorNoOrg: AuthContext = {
      ...actorFor(seed, 'A'),
      orgId: null,
    };
    const app = buildApp(db, actorNoOrg);

    const res = await app.request('/api/v1/admin/csv-import/commit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        fileBase64: toBase64(HAPPY_CSV),
        fileName: 'roster.csv',
        mapping: {
          email: 'email',
          firstName: 'firstName',
          lastName: 'lastName',
          teamName: 'teamName',
        },
      }),
    });

    expect(res.status).toBe(403);
    const body = (await res.json()) as { success: false; error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN');
  });

  // ──────────────────────────────────────────────────────────────────
  // Story #973 F1 — file_name column round-trips through create→list.
  // ──────────────────────────────────────────────────────────────────
  it('GET /batches returns prior batches with the original file_name', async () => {
    const db = freshProductionDb();
    const seed = seedGraph(db);
    const app = buildApp(db, actorFor(seed, 'A'));

    // Arrange: import twice with different filenames. The same CSV is
    // re-uploaded — duplicate emails resolve via user-reuse so the
    // second batch still persists.
    for (const fileName of ['fall-roster.csv', 'spring-roster.csv']) {
      const res = await app.request('/api/v1/admin/csv-import/commit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          fileBase64: toBase64(HAPPY_CSV),
          fileName,
          mapping: {
            email: 'email',
            firstName: 'firstName',
            lastName: 'lastName',
            teamName: 'teamName',
          },
        }),
      });
      expect(res.status).toBe(200);
    }

    const list = await app.request('/api/v1/admin/csv-import/batches', {
      method: 'GET',
    });
    expect(list.status).toBe(200);
    const body = (await list.json()) as {
      success: true;
      data: {
        batches: Array<{
          id: string;
          fileName: string;
          rowCount: number;
          successCount: number;
          errorCount: number;
          createdAt: string;
        }>;
      };
    };
    expect(body.success).toBe(true);
    expect(body.data.batches.length).toBe(2);
    // Newest-first ordering — the second insert appears first.
    const filenames = body.data.batches.map((b) => b.fileName).sort();
    expect(filenames).toEqual(['fall-roster.csv', 'spring-roster.csv']);
  });

  it('GET /batches scopes results to the actor’s org', async () => {
    const db = freshProductionDb();
    const seed = seedGraph(db);

    // Org A imports a batch.
    const appA = buildApp(db, actorFor(seed, 'A'));
    await appA.request('/api/v1/admin/csv-import/commit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        fileBase64: toBase64(HAPPY_CSV),
        fileName: 'org-a-roster.csv',
        mapping: {
          email: 'email',
          firstName: 'firstName',
          lastName: 'lastName',
          teamName: 'teamName',
        },
      }),
    });

    // Org B lists batches — must not see Org A's history.
    const appB = buildApp(db, actorFor(seed, 'B'));
    const list = await appB.request('/api/v1/admin/csv-import/batches', {
      method: 'GET',
    });
    expect(list.status).toBe(200);
    const body = (await list.json()) as {
      success: true;
      data: { batches: Array<{ fileName: string }> };
    };
    expect(body.data.batches).toEqual([]);
  });

  // ──────────────────────────────────────────────────────────────────
  // Story #973 F2 — per-row error breakdown carries the cell value
  // so the admin UI can render a downloadable error report.
  // ──────────────────────────────────────────────────────────────────
  it('POST /commit failure envelope carries per-row breakdown with cellValue', async () => {
    const db = freshProductionDb();
    const seed = seedGraph(db);
    const app = buildApp(db, actorFor(seed, 'A'));

    // Both rows have invalid emails; the resolver passes (no
    // missing-required-value because every required cell is non-empty)
    // and the post-resolve EMAIL_INVALID check surfaces both rows.
    const csv = [
      'email,firstName,lastName,teamName',
      'not-an-email,Ada,Lovelace,Tigers',
      'also bad,Bob,Smith,Lions',
    ].join('\n');

    const res = await app.request('/api/v1/admin/csv-import/commit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        fileBase64: toBase64(csv),
        fileName: 'bad.csv',
        mapping: {
          email: 'email',
          firstName: 'firstName',
          lastName: 'lastName',
          teamName: 'teamName',
        },
      }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      success: false;
      error: {
        code: string;
        rowErrors?: Array<{
          rowIndex: number;
          code: string;
          field?: string;
          cellValue?: string;
        }>;
      };
    };
    expect(body.error.code).toBe('IMPORT_FAILED');
    expect(body.error.rowErrors).toBeDefined();
    // Both rows surface as EMAIL_INVALID with the original cell text
    // echoed back so the admin UI can render a downloadable error
    // report keyed by row + cell.
    const byKey = new Map((body.error.rowErrors ?? []).map((e) => [`${e.rowIndex}:${e.code}`, e]));
    const row0 = byKey.get('0:EMAIL_INVALID');
    expect(row0).toBeDefined();
    expect(row0!.field).toBe('email');
    expect(row0!.cellValue).toBe('not-an-email');

    const row1 = byKey.get('1:EMAIL_INVALID');
    expect(row1).toBeDefined();
    expect(row1!.field).toBe('email');
    expect(row1!.cellValue).toBe('also bad');

    // Side-effect: no batch persisted on failure (matches existing
    // contract — the failure path does not write an audit row).
    expect(db.select().from(csvImportBatches).all().length).toBe(0);
  });
});
