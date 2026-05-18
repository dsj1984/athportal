// apps/api/src/routes/v1/me.contract.test.ts
//
// Contract test for GET /api/v1/me (Story #330, Task #344).
//
// Asserts the success envelope shape and that the route is gated by
// the auth chain. Anonymous callers receive 401; authenticated callers
// receive `{ success: true, data: { userId, role, ... } }`.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { users } from '@repo/shared/db/schema';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@clerk/backend', () => ({
  verifyToken: vi.fn(),
}));

import { verifyToken } from '@clerk/backend';
import { type RequireInternalUserEnv, clerkAuth, requireInternalUser } from '../../middleware/auth';
import { meRoute } from './me';

const mockedVerifyToken = vi.mocked(verifyToken);

const MIGRATION_PATH = join(
  __dirname,
  '../../../../../packages/shared/src/db/migrations/0000_auth_and_rbac.sql',
);

function freshDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  const migration = readFileSync(MIGRATION_PATH, 'utf8');
  for (const stmt of migration.split('--> statement-breakpoint').map((s) => s.trim())) {
    if (stmt.length > 0) sqlite.exec(stmt);
  }
  return drizzle(sqlite, { schema: { users } });
}

function buildApp(db: ReturnType<typeof freshDb>) {
  const app = new Hono<RequireInternalUserEnv>();
  app.use('*', async (c, next) => {
    c.set('db', db);
    await next();
  });
  app.use('*', clerkAuth());
  app.use('*', requireInternalUser());
  app.route('/api/v1/me', meRoute);
  return app;
}

const env = {
  CLERK_SECRET_KEY: 'sk_test_unit',
  CLERK_PUBLISHABLE_KEY: 'pk_test_unit',
  ANALYTICS: { writeDataPoint: () => {} },
};

beforeEach(() => {
  mockedVerifyToken.mockReset();
});

describe('GET /api/v1/me', () => {
  it('returns 401 for anonymous callers', async () => {
    const app = buildApp(freshDb());
    const res = await app.request('/api/v1/me', { method: 'GET' }, env);
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({
      success: false,
      error: { code: 'UNAUTHENTICATED' },
    });
  });

  it('returns the AuthContext payload for an authenticated caller', async () => {
    mockedVerifyToken.mockResolvedValueOnce({
      data: { sub: 'user_me_1' },
    } as unknown as Awaited<ReturnType<typeof verifyToken>>);

    const db = freshDb();
    const app = buildApp(db);
    const res = await app.request(
      '/api/v1/me',
      {
        method: 'GET',
        headers: { cookie: '__session=valid' },
      },
      env,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: {
        userId: string;
        role: string;
        orgId: string | null;
        teamId: string | null;
        email: string;
      };
    };
    expect(body.success).toBe(true);
    expect(body.data.role).toBe('member');
    expect(body.data.userId).toMatch(/^u_/);
    expect(body.data.orgId).toBeNull();
    expect(body.data.teamId).toBeNull();
  });

  it('does not echo internal-error details on token rejection', async () => {
    mockedVerifyToken.mockResolvedValueOnce({
      errors: [new Error('jwt secret rotation pending')],
    } as unknown as Awaited<ReturnType<typeof verifyToken>>);

    const app = buildApp(freshDb());
    const res = await app.request(
      '/api/v1/me',
      { method: 'GET', headers: { cookie: '__session=bad' } },
      env,
    );

    expect(res.status).toBe(401);
    const text = await res.text();
    expect(text).not.toMatch(/jwt secret rotation/);
    expect(text).not.toMatch(/stack/i);
  });
});
