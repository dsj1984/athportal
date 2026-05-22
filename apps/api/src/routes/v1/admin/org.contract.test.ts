// apps/api/src/routes/v1/admin/org.contract.test.ts
//
// Contract test for GET / PATCH /api/v1/admin/org (Epic #10 / Story
// #656 / Task #673).
//
// Pins the wire shape established by Tech Spec #318 §API plus the
// per-Task acceptance criteria:
//
//   1. GET — returns 200 with the canonical success envelope and a
//      data payload scoped to the actor's org.
//   2. PATCH — happy path returns 200, the updated row reflects the
//      patch, and a subsequent GET observes the new values.
//   3. PATCH — invalid `primaryColorHex` returns 400 VALIDATION_ERROR
//      (the Zod hex pattern is the boundary).
//   4. Cross-tenant — an `org_admin` from org A cannot read or mutate
//      org B's row; the handler returns NOT_FOUND rather than leaking
//      the existence of a foreign row.
//
// Tier: contract. Uses `createTestApp(db, { actor })` to drive the
// real `adminRoute` (including its `requireRole('org_admin')` gate)
// against an ephemeral SQLite seeded with the production migrations.
// No policy mock, no Clerk SDK mock.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { organizations } from '@repo/shared/db/schema';
import { type AuthContext, createTestApp } from '@repo/shared/testing';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { RequireInternalUserEnv } from '../../../middleware/auth';
import { adminRoute } from './index';

// The Drizzle migrations live under `packages/shared/src/db/migrations`.
// Resolve the path relative to this test file so the suite is portable
// across worktrees.
const MIGRATIONS_DIR = join(__dirname, '../../../../../../packages/shared/src/db/migrations');
const MIGRATION_FILES = [
  '0000_auth_and_rbac.sql',
  '0001_onboarding_schema.sql',
  '0002_org_team_graph.sql',
  '0003_invitations.sql',
  '0004_org_branding.sql',
];

function freshDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  for (const file of MIGRATION_FILES) {
    const migration = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    for (const stmt of migration.split('--> statement-breakpoint').map((s) => s.trim())) {
      if (stmt.length > 0) sqlite.exec(stmt);
    }
  }
  return drizzle(sqlite, { schema: { organizations } });
}

function seedOrg(
  db: ReturnType<typeof freshDb>,
  overrides: {
    id: string;
    name?: string;
    primaryColorHex?: string | null;
    logoR2Key?: string | null;
  },
): void {
  db.insert(organizations)
    .values({
      id: overrides.id,
      name: overrides.name ?? `Test Org ${overrides.id}`,
      organizationType: 'CLUB',
      primaryColorHex: overrides.primaryColorHex ?? null,
      logoR2Key: overrides.logoR2Key ?? null,
    })
    .run();
}

function actor(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: 'u_admin_actor',
    clerkSubjectId: 'user_admin_subject',
    email: 'admin@test.invalid',
    role: 'org_admin',
    orgId: 'org-a',
    teamId: null,
    ...overrides,
  };
}

function buildApp(db: ReturnType<typeof freshDb>, a: AuthContext) {
  const app = createTestApp(db, {
    actor: a,
  }) as unknown as Hono<RequireInternalUserEnv>;
  app.route('/api/v1/admin', adminRoute);
  return app;
}

describe('GET /api/v1/admin/org — contract', () => {
  it('returns 200 with the org row scoped to the actor', async () => {
    // Arrange
    const db = freshDb();
    seedOrg(db, { id: 'org-a', name: 'Alpha Athletics', primaryColorHex: '#112233' });
    const app = buildApp(db, actor({ orgId: 'org-a' }));

    // Act
    const res = await app.request('/api/v1/admin/org', { method: 'GET' });

    // Assert — wire shape
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: {
        id: string;
        name: string;
        sports: string[];
        contactEmail: string | null;
        contactPhone: string | null;
        primaryColorHex: string | null;
        logoUrl: string | null;
      };
    };
    expect(body).toEqual({
      success: true,
      data: {
        id: 'org-a',
        name: 'Alpha Athletics',
        sports: [],
        contactEmail: null,
        contactPhone: null,
        primaryColorHex: '#112233',
        logoUrl: null,
      },
    });
  });

  it('returns 404 NOT_FOUND when the actor has no orgId in scope', async () => {
    const db = freshDb();
    seedOrg(db, { id: 'org-a' });
    // A dev_admin with no org context: the role gate admits them, but
    // the handler cannot resolve a target row and surfaces NOT_FOUND.
    const app = buildApp(db, actor({ role: 'dev_admin', orgId: null }));

    const res = await app.request('/api/v1/admin/org', { method: 'GET' });

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({
      success: false,
      error: { code: 'NOT_FOUND' },
    });
  });
});

describe('PATCH /api/v1/admin/org — contract', () => {
  it('updates the org and a subsequent GET reflects the change', async () => {
    // Arrange
    const db = freshDb();
    seedOrg(db, { id: 'org-a', name: 'Alpha Athletics', primaryColorHex: '#000000' });
    const app = buildApp(db, actor({ orgId: 'org-a' }));

    // Act — PATCH
    const patchRes = await app.request('/api/v1/admin/org', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Alpha Athletics Renamed', primaryColorHex: '#abcdef' }),
    });

    // Assert — wire shape
    expect(patchRes.status).toBe(200);
    const patched = (await patchRes.json()) as {
      success: boolean;
      data: { name: string; primaryColorHex: string | null };
    };
    expect(patched.success).toBe(true);
    expect(patched.data.name).toBe('Alpha Athletics Renamed');
    expect(patched.data.primaryColorHex).toBe('#abcdef');

    // Assert — DB side-effect
    const reloaded = db.select().from(organizations).where(eq(organizations.id, 'org-a')).all();
    expect(reloaded[0]?.name).toBe('Alpha Athletics Renamed');
    expect(reloaded[0]?.primaryColorHex).toBe('#abcdef');

    // Assert — round-trip via GET
    const getRes = await app.request('/api/v1/admin/org', { method: 'GET' });
    const got = (await getRes.json()) as {
      data: { name: string; primaryColorHex: string | null };
    };
    expect(got.data.name).toBe('Alpha Athletics Renamed');
    expect(got.data.primaryColorHex).toBe('#abcdef');
  });

  it('returns 400 VALIDATION_ERROR for an invalid primary_color_hex', async () => {
    const db = freshDb();
    seedOrg(db, { id: 'org-a' });
    const app = buildApp(db, actor({ orgId: 'org-a' }));

    const res = await app.request('/api/v1/admin/org', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ primaryColorHex: 'not-a-hex' }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      success: false,
      error: { code: 'VALIDATION_ERROR' },
    });

    // And the DB column is unchanged.
    const reloaded = db.select().from(organizations).where(eq(organizations.id, 'org-a')).all();
    expect(reloaded[0]?.primaryColorHex).toBeNull();
  });

  it('returns 400 VALIDATION_ERROR when the body carries an unknown key', async () => {
    const db = freshDb();
    seedOrg(db, { id: 'org-a' });
    const app = buildApp(db, actor({ orgId: 'org-a' }));

    const res = await app.request('/api/v1/admin/org', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      // `organizationType` is not on the patch surface — strict() rejects.
      body: JSON.stringify({ organizationType: 'COLLEGE' }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      success: false,
      error: { code: 'VALIDATION_ERROR' },
    });
  });
});

describe('cross-tenant isolation — contract', () => {
  it('GET from org-a never observes org-b', async () => {
    const db = freshDb();
    seedOrg(db, { id: 'org-a', name: 'Alpha' });
    seedOrg(db, { id: 'org-b', name: 'Bravo' });
    const app = buildApp(db, actor({ orgId: 'org-a' }));

    const res = await app.request('/api/v1/admin/org', { method: 'GET' });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { id: string; name: string } };
    expect(body.data.id).toBe('org-a');
    expect(body.data.name).toBe('Alpha');
  });

  it('PATCH from org-a does not mutate org-b', async () => {
    const db = freshDb();
    seedOrg(db, { id: 'org-a', name: 'Alpha', primaryColorHex: '#aaaaaa' });
    seedOrg(db, { id: 'org-b', name: 'Bravo', primaryColorHex: '#bbbbbb' });
    const app = buildApp(db, actor({ orgId: 'org-a' }));

    await app.request('/api/v1/admin/org', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ primaryColorHex: '#cccccc' }),
    });

    // org-b row MUST be untouched.
    const reloaded = db.select().from(organizations).where(eq(organizations.id, 'org-b')).all();
    expect(reloaded[0]?.primaryColorHex).toBe('#bbbbbb');
    expect(reloaded[0]?.name).toBe('Bravo');
  });
});
