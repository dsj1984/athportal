// apps/api/src/middleware/requireRole.contract.test.ts
//
// Contract test for `requireRole(role)` (Story #654, Task #659, Epic #10).
//
// Pins the wire shape the role gate promises:
//
//   1. Actor whose role differs from the required role → 403 with the
//      canonical FORBIDDEN envelope.
//   2. Actor whose role matches the required role → passes through to
//      the downstream handler.
//   3. `dev_admin` actor → passes through any `requireRole(...)` gate.
//
// Tier: contract. Uses `createTestApp(db, { actor })` to drive the
// production middleware against an ephemeral SQLite — no Clerk SDK
// mock, no policy mock. The only seam substituted is the
// JWT-validator stage.

import { type AuthContext, type TestDbLike, createTestApp } from '@repo/shared/testing';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { RequireInternalUserEnv } from './auth';
import { requireRole } from './requireRole';

/**
 * Build a minimal in-memory DB handle. `requireRole` does not consult
 * the database (the policy is pure), so we only need a handle for the
 * test-auth seam's `c.var.db` slot.
 */
function freshDb(): TestDbLike {
  const sqlite = new Database(':memory:');
  return drizzle(sqlite, { schema: {} }) as unknown as TestDbLike;
}

function actor(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: 'u_test_actor',
    clerkSubjectId: 'user_test_subject',
    email: 'actor@test.invalid',
    role: 'org_admin',
    orgId: 'org_test_a',
    teamId: null,
    ...overrides,
  };
}

function buildApp(a: AuthContext, gateRole: 'dev_admin' | 'org_admin' | 'team_admin' | 'member') {
  const db = freshDb();
  const app = createTestApp(db, { actor: a }) as unknown as Hono<RequireInternalUserEnv>;
  app.use('/api/v1/admin/*', requireRole(gateRole));
  app.get('/api/v1/admin/ping', (c) => c.json({ success: true, data: { ok: true } }));
  return app;
}

describe('requireRole — contract', () => {
  it('returns 403 FORBIDDEN when the actor role does not satisfy the required role', async () => {
    const a = actor({ role: 'team_admin' });
    const app = buildApp(a, 'org_admin');

    const res = await app.request('/api/v1/admin/ping', { method: 'GET' });

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      success: false,
      error: { code: 'FORBIDDEN' },
    });
  });

  it('returns 403 FORBIDDEN for a member actor on an org_admin-gated route', async () => {
    const a = actor({ role: 'member', orgId: 'org_test_a' });
    const app = buildApp(a, 'org_admin');

    const res = await app.request('/api/v1/admin/ping', { method: 'GET' });

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      success: false,
      error: { code: 'FORBIDDEN' },
    });
  });

  it('passes through to the next handler when the actor role matches the required role', async () => {
    const a = actor({ role: 'org_admin', orgId: 'org_test_a' });
    const app = buildApp(a, 'org_admin');

    const res = await app.request('/api/v1/admin/ping', { method: 'GET' });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      success: true,
      data: { ok: true },
    });
  });

  it('passes a dev_admin actor through any requireRole gate', async () => {
    const a = actor({ role: 'dev_admin', orgId: null });
    const app = buildApp(a, 'org_admin');

    const res = await app.request('/api/v1/admin/ping', { method: 'GET' });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      success: true,
      data: { ok: true },
    });
  });

  it('returns 403 FORBIDDEN when no auth context is present (defensive)', async () => {
    // No `{ actor }` option → c.var.auth is undefined. The middleware
    // MUST refuse rather than crash or read `undefined.role`.
    const db = freshDb();
    const app = createTestApp(db) as unknown as Hono<RequireInternalUserEnv>;
    app.use('/api/v1/admin/*', requireRole('org_admin'));
    app.get('/api/v1/admin/ping', (c) => c.json({ success: true, data: { ok: true } }));

    const res = await app.request('/api/v1/admin/ping', { method: 'GET' });

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      success: false,
      error: { code: 'FORBIDDEN' },
    });
  });
});
