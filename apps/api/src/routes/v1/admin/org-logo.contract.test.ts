// apps/api/src/routes/v1/admin/org-logo.contract.test.ts
//
// Contract test for the org-logo upload endpoints (Epic #10 / Story
// #656 / Task #675):
//
//   POST /api/v1/admin/org/logo-upload-url
//   POST /api/v1/admin/org/logo-finalize
//
// Pins the wire shape from the per-Task acceptance criteria:
//
//   1. Upload-URL — happy path returns 200 with `{ uploadUrl, key }`
//      under the canonical success envelope, and the key sits under
//      the actor's `logos/<orgId>/` namespace.
//   2. Upload-URL — disallowed content-type returns 400
//      UNSUPPORTED_MEDIA_TYPE.
//   3. Upload-URL — oversized payload returns 400 PAYLOAD_TOO_LARGE.
//   4. Finalize — persists `logo_r2_key` on the actor's org row and
//      returns the resolved `logoUrl`.
//   5. Cross-tenant — finalize refuses a key that does not match the
//      actor's `logos/<orgId>/` prefix.
//
// The signer is stubbed via a single-purpose middleware that injects
// a deterministic presigned URL — the production SigV4 wiring lives
// in a follow-up and is out of scope for this contract surface.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { organizations } from '@repo/shared/db/schema';
import { type AuthContext, type TestDbLike, createTestApp } from '@repo/shared/testing';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { RequireInternalUserEnv } from '../../../middleware/auth';
import { adminRoute } from './index';
import type { LogoUploadSigner } from './org';

const MIGRATIONS_DIR = join(
  __dirname,
  '../../../../../../packages/shared/src/db/migrations',
);
const MIGRATION_FILES = [
  '0000_auth_and_rbac.sql',
  '0001_onboarding_schema.sql',
  '0002_org_team_graph.sql',
  '0003_org_branding.sql',
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

function seedOrg(db: ReturnType<typeof freshDb>, id: string): void {
  db.insert(organizations)
    .values({ id, name: `Test Org ${id}`, organizationType: 'CLUB' })
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

/**
 * Deterministic stub signer. Returns a URL that encodes the requested
 * key + content-type so assertions can pin the exact value the route
 * forwarded to the signer.
 */
function stubSigner(): LogoUploadSigner {
  return {
    async createPresignedPutUrl({ key, contentType }) {
      return { uploadUrl: `https://r2-stub.invalid/${key}?ct=${encodeURIComponent(contentType)}` };
    },
  };
}

function buildApp(
  db: ReturnType<typeof freshDb>,
  a: AuthContext,
  signer: LogoUploadSigner | null = stubSigner(),
) {
  const app = createTestApp(db as unknown as TestDbLike, { actor: a }) as unknown as Hono<RequireInternalUserEnv>;
  if (signer) {
    app.use('*', async (c, next) => {
      (c.set as unknown as (k: string, v: unknown) => void)('logoUploadSigner', signer);
      await next();
    });
  }
  app.route('/api/v1/admin', adminRoute);
  return app;
}

describe('POST /api/v1/admin/org/logo-upload-url — contract', () => {
  it('returns 200 with a presigned uploadUrl and per-org key', async () => {
    const db = freshDb();
    seedOrg(db, 'org-a');
    const app = buildApp(db, actor({ orgId: 'org-a' }));

    const res = await app.request('/api/v1/admin/org/logo-upload-url', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contentType: 'image/png', contentLength: 1024 }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { uploadUrl: string; key: string };
    };
    expect(body.success).toBe(true);
    expect(body.data.key.startsWith('logos/org-a/')).toBe(true);
    expect(body.data.key.endsWith('.png')).toBe(true);
    expect(body.data.uploadUrl).toContain(body.data.key);
    expect(body.data.uploadUrl).toContain('ct=image%2Fpng');
  });

  it('returns 400 UNSUPPORTED_MEDIA_TYPE for a disallowed content-type', async () => {
    const db = freshDb();
    seedOrg(db, 'org-a');
    const app = buildApp(db, actor({ orgId: 'org-a' }));

    const res = await app.request('/api/v1/admin/org/logo-upload-url', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contentType: 'image/gif', contentLength: 1024 }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      success: false,
      error: { code: 'UNSUPPORTED_MEDIA_TYPE' },
    });
  });

  it('returns 400 PAYLOAD_TOO_LARGE for contentLength above the 2 MB cap', async () => {
    const db = freshDb();
    seedOrg(db, 'org-a');
    const app = buildApp(db, actor({ orgId: 'org-a' }));

    const res = await app.request('/api/v1/admin/org/logo-upload-url', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contentType: 'image/png',
        // 2 MB + 1 byte
        contentLength: 2 * 1024 * 1024 + 1,
      }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      success: false,
      error: { code: 'PAYLOAD_TOO_LARGE' },
    });
  });

  it('returns 400 VALIDATION_ERROR when the body shape is wrong', async () => {
    const db = freshDb();
    seedOrg(db, 'org-a');
    const app = buildApp(db, actor({ orgId: 'org-a' }));

    const res = await app.request('/api/v1/admin/org/logo-upload-url', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contentType: 'image/png' }), // missing contentLength
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      success: false,
      error: { code: 'VALIDATION_ERROR' },
    });
  });
});

describe('POST /api/v1/admin/org/logo-finalize — contract', () => {
  it('persists logo_r2_key on the actor org and returns the derived logoUrl', async () => {
    const db = freshDb();
    seedOrg(db, 'org-a');
    const app = buildApp(db, actor({ orgId: 'org-a' }));

    // Mint a key via the upload-URL endpoint so the finalize step
    // exercises the same key shape the client would have received.
    const mintRes = await app.request('/api/v1/admin/org/logo-upload-url', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contentType: 'image/png', contentLength: 1024 }),
    });
    const mint = (await mintRes.json()) as { data: { key: string } };
    const key = mint.data.key;

    const env = { R2_PUBLIC_BASE_URL: 'https://cdn.example.invalid' };
    const res = await app.request(
      '/api/v1/admin/org/logo-finalize',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key }),
      },
      env,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { logoUrl: string };
    };
    expect(body.success).toBe(true);
    expect(body.data.logoUrl).toBe(`https://cdn.example.invalid/${key}`);

    // DB side-effect: column persisted on the row.
    const reloaded = db
      .select()
      .from(organizations)
      .where(eq(organizations.id, 'org-a'))
      .all();
    expect(reloaded[0]?.logoR2Key).toBe(key);
  });

  it('refuses a key that does not belong to the actor org', async () => {
    const db = freshDb();
    seedOrg(db, 'org-a');
    seedOrg(db, 'org-b');
    const app = buildApp(db, actor({ orgId: 'org-a' }));

    const res = await app.request('/api/v1/admin/org/logo-finalize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'logos/org-b/foreign.png' }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      success: false,
      error: { code: 'VALIDATION_ERROR' },
    });

    // org-a row's logo_r2_key MUST remain null.
    const reloaded = db
      .select()
      .from(organizations)
      .where(eq(organizations.id, 'org-a'))
      .all();
    expect(reloaded[0]?.logoR2Key).toBeNull();
  });
});
