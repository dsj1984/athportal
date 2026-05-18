// apps/api/src/routes/v1/users/role.contract.test.ts
//
// Contract test for PATCH /api/v1/users/:id/role (Story #340,
// Task #352, Tech Spec #318 §E).
//
// Covers the wire shape established by Story #330 plus the
// last-admin invariant the route enforces:
//
//   1. Happy path — org_admin demotes another org_admin while
//      another admin remains. Asserts 200, success envelope, and
//      that the post-update users.role column matches the new role
//      (DB side-effect).
//   2. Refusal — org_admin attempts to demote the last admin in
//      their org. Asserts 409, `{ success: false, error: {
//      code: 'LAST_ADMIN', message: <non-empty string> } }`, AND
//      that the target row's `role` column is UNCHANGED after the
//      attempt (rollback verification).
//
// The 401 / authz failure surface for this route is verified by
// the broader auth.contract.test.ts (Task #346); this suite focuses
// on the last-admin wire shape per the Task brief.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { users } from '@repo/shared/db/schema';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@clerk/backend', () => ({
  verifyToken: vi.fn(),
}));

import { verifyToken } from '@clerk/backend';
import {
  type RequireInternalUserEnv,
  clerkAuth,
  requireInternalUser,
} from '../../../middleware/auth';
import { userRoleRoute } from './role';

const mockedVerifyToken = vi.mocked(verifyToken);

const MIGRATION_PATH = join(
  __dirname,
  '../../../../../../packages/shared/src/db/migrations/0000_auth_and_rbac.sql',
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
  app.route('/api/v1/users', userRoleRoute);
  return app;
}

const env = {
  CLERK_SECRET_KEY: 'sk_test_unit',
  CLERK_PUBLISHABLE_KEY: 'pk_test_unit',
  ANALYTICS: { writeDataPoint: () => {} },
};

/**
 * Insert a row directly so we can fully control id / org / role
 * without going through the JIT path. The actor row is created via
 * the JIT path on the first request; these helpers seed the
 * additional users the test needs to reason about admin counts.
 */
interface SeededUser {
  id: string;
  clerkSubjectId: string;
  email: string;
  role: string;
  orgId: string | null;
}

function seedUser(db: ReturnType<typeof freshDb>, overrides: Partial<SeededUser>): SeededUser {
  const id = overrides.id ?? `u_seed_${Math.random().toString(36).slice(2, 10)}`;
  const row: SeededUser = {
    id,
    clerkSubjectId: overrides.clerkSubjectId ?? `clerk_${id}`,
    email: overrides.email ?? `${id}@example.invalid`,
    role: overrides.role ?? 'member',
    orgId: overrides.orgId ?? null,
  };
  db.insert(users)
    .values({
      id: row.id,
      clerkSubjectId: row.clerkSubjectId,
      email: row.email,
      role: row.role,
      orgId: row.orgId,
    })
    .run();
  return row;
}

function seedOrg(db: ReturnType<typeof freshDb>, orgId: string): void {
  // The migration declares organizations.id as a FK target; insert
  // a row so users.org_id passes the FK check.
  db.run(`INSERT INTO organizations (id, name) VALUES ('${orgId}', 'Test Org ${orgId}')`);
}

/**
 * After clerkAuth attaches the subject, requireInternalUser will
 * either find an existing row (if we've seeded one with the same
 * clerk_subject_id) or JIT-insert a fresh one. For this suite we
 * seed the actor explicitly so we can pin the actor's role + orgId.
 */
function seedActor(
  db: ReturnType<typeof freshDb>,
  subject: string,
  overrides: Partial<SeededUser> = {},
): SeededUser {
  return seedUser(db, {
    id: overrides.id ?? `u_actor_${subject}`,
    clerkSubjectId: subject,
    email: overrides.email ?? `${subject}@example.invalid`,
    role: overrides.role ?? 'org_admin',
    orgId: overrides.orgId ?? null,
  });
}

beforeEach(() => {
  mockedVerifyToken.mockReset();
});

describe('PATCH /api/v1/users/:id/role — last-admin invariant', () => {
  it('returns 200 and updates the row when another admin remains', async () => {
    // Arrange — org with TWO org_admins; actor demotes the other one.
    const db = freshDb();
    seedOrg(db, 'org-1');
    const actor = seedActor(db, 'clerk_actor_1', {
      role: 'org_admin',
      orgId: 'org-1',
    });
    const target = seedUser(db, {
      id: 'u_target_1',
      role: 'org_admin',
      orgId: 'org-1',
    });

    mockedVerifyToken.mockResolvedValueOnce({
      data: { sub: actor.clerkSubjectId },
    } as unknown as Awaited<ReturnType<typeof verifyToken>>);

    const app = buildApp(db);

    // Act
    const res = await app.request(
      `/api/v1/users/${target.id}/role`,
      {
        method: 'PATCH',
        headers: {
          cookie: '__session=valid',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ role: 'member' }),
      },
      env,
    );

    // Assert — wire shape
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { userId: string; role: string };
    };
    expect(body.success).toBe(true);
    expect(body.data.userId).toBe(target.id);
    expect(body.data.role).toBe('member');

    // Assert — DB side-effect: the row's role column reflects the
    // new value (contract-tier round-trip).
    const reloaded = db.select().from(users).where(eq(users.id, target.id)).all();
    expect(reloaded[0]?.role).toBe('member');
  });

  it('returns 409 LAST_ADMIN and rolls back when the demotion would drop the last admin', async () => {
    // Arrange — org with ONE org_admin (the actor); actor attempts
    // to demote themselves. The post-update admin count drops to 0,
    // so the policy denies; the transaction rolls back; the row's
    // role MUST remain 'org_admin'.
    const db = freshDb();
    seedOrg(db, 'org-solo');
    const actor = seedActor(db, 'clerk_actor_solo', {
      id: 'u_actor_solo',
      role: 'org_admin',
      orgId: 'org-solo',
    });

    mockedVerifyToken.mockResolvedValueOnce({
      data: { sub: actor.clerkSubjectId },
    } as unknown as Awaited<ReturnType<typeof verifyToken>>);

    const app = buildApp(db);

    // Act
    const res = await app.request(
      `/api/v1/users/${actor.id}/role`,
      {
        method: 'PATCH',
        headers: {
          cookie: '__session=valid',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ role: 'member' }),
      },
      env,
    );

    // Assert — wire shape: 409 with the canonical envelope and the
    // LAST_ADMIN code. The message MUST be non-empty (the operator
    // surfaces it to the user) but the test does not pin the exact
    // wording — that's a copy decision, not a wire contract.
    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      success: boolean;
      error: { code: string; message: string };
    };
    expect(body).toMatchObject({
      success: false,
      error: { code: 'LAST_ADMIN' },
    });
    expect(typeof body.error.message).toBe('string');
    expect(body.error.message.length).toBeGreaterThan(0);

    // Assert — rollback: re-select the row and confirm the role
    // column is unchanged. This is the load-bearing DB-state
    // assertion that proves the in-transaction guard works (no
    // partial mutation reached storage on the denied path).
    const reloaded = db.select().from(users).where(eq(users.id, actor.id)).all();
    expect(reloaded[0]?.role).toBe('org_admin');
  });
});
