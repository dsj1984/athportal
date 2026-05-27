// apps/api/src/routes/v1/sign-out.contract.test.ts
//
// Contract test for POST /api/v1/sign-out (Story #330, Task #344).
//
// Asserts:
//   - 204 No Content on success.
//   - Set-Cookie clears `__session` with HttpOnly + Secure + SameSite=Lax.
//   - Anonymous callers receive 401.
//
// Cookie-flag assertion lives here AND in the auth.contract.test.ts
// suite owned by Task #346 (which exercises the broader cookie-flag
// surface across the sign-in flow). Duplicating the assertion at the
// route is fine — Task #344's acceptance explicitly checks the cookie
// clear behaviour.

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
import { signOutRoute } from './sign-out';

const mockedVerifyToken = vi.mocked(verifyToken);

const MIGRATIONS_DIR = join(__dirname, '../../../../../packages/shared/src/db/migrations');
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
  app.route('/api/v1/sign-out', signOutRoute);
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

describe('POST /api/v1/sign-out', () => {
  it('returns 204 and clears the __session cookie with security flags', async () => {
    mockedVerifyToken.mockResolvedValueOnce({
      sub: 'user_signout_1',
    } as unknown as Awaited<ReturnType<typeof verifyToken>>);

    const app = buildApp(freshDb());
    const res = await app.request(
      '/api/v1/sign-out',
      {
        method: 'POST',
        headers: { cookie: '__session=valid' },
      },
      env,
    );

    expect(res.status).toBe(204);

    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).not.toBeNull();
    expect(setCookie).toMatch(/^__session=;/);
    expect(setCookie).toMatch(/Max-Age=0/i);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/Secure/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).toMatch(/Path=\//i);
  });

  it('returns 401 for anonymous callers', async () => {
    const app = buildApp(freshDb());
    const res = await app.request('/api/v1/sign-out', { method: 'POST' }, env);
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({
      success: false,
      error: { code: 'UNAUTHENTICATED' },
    });
  });
});
