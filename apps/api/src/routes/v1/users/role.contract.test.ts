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
  db.run(
    `INSERT INTO organizations (id, name, organization_type) VALUES ('${orgId}', 'Test Org ${orgId}', 'CLUB')`,
  );
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
      sub: actor.clerkSubjectId,
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
      sub: actor.clerkSubjectId,
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

  // Story #615 (Epic #9, Task #629): cross-tenant defense — an
  // org_admin in org A patching a user in org B MUST surface 404
  // NOT_FOUND (scopedDb scopes the UPDATE's WHERE to
  // `eq(users.org_id, actor.orgId)`, so the cross-tenant target
  // matches zero rows and the route's existing NOT_FOUND branch
  // fires). The org B row MUST remain untouched.
  it('returns 404 NOT_FOUND and leaves the cross-tenant row untouched when an org_admin targets a user in a different org', async () => {
    // Arrange — two orgs, one org_admin per org. The actor sits
    // in org-a and attempts to demote the org-b admin.
    const db = freshDb();
    seedOrg(db, 'org-a');
    seedOrg(db, 'org-b');
    const actor = seedActor(db, 'clerk_actor_cross', {
      id: 'u_actor_cross',
      role: 'org_admin',
      orgId: 'org-a',
    });
    const crossTarget = seedUser(db, {
      id: 'u_target_orgb',
      role: 'org_admin',
      orgId: 'org-b',
    });

    mockedVerifyToken.mockResolvedValueOnce({
      sub: actor.clerkSubjectId,
    } as unknown as Awaited<ReturnType<typeof verifyToken>>);

    const app = buildApp(db);

    // Act — patch the org-b target's role from the org-a actor.
    const res = await app.request(
      `/api/v1/users/${crossTarget.id}/role`,
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

    // Assert — wire shape: 404 with the canonical NOT_FOUND
    // envelope. The exact wording of the message is not pinned
    // (copy decision, not a wire contract) — only that the
    // envelope shape and code are correct.
    expect(res.status).toBe(404);
    const body = (await res.json()) as {
      success: boolean;
      error: { code: string; message: string };
    };
    expect(body).toMatchObject({
      success: false,
      error: { code: 'NOT_FOUND' },
    });
    expect(typeof body.error.message).toBe('string');
    expect(body.error.message.length).toBeGreaterThan(0);

    // Assert — DB side-effect: the org-b target's row is
    // unchanged. This is the load-bearing cross-tenant defense
    // assertion — the scopedDb-wrapped UPDATE must have matched
    // zero rows, so the column value stays 'org_admin'.
    const reloaded = db.select().from(users).where(eq(users.id, crossTarget.id)).all();
    expect(reloaded[0]?.role).toBe('org_admin');
    expect(reloaded[0]?.orgId).toBe('org-b');
  });

  it('returns 403 FORBIDDEN when a non-dev_admin actor has no orgId (pre-onboarding tenant scope)', async () => {
    // Arrange — a `member` whose orgId is null (the routine
    // post-JIT, pre-onboarding state per
    // apps/api/src/middleware/auth.ts:252-255). The route should
    // refuse the mutation as a *policy* outcome (403 FORBIDDEN),
    // not as a server error. Pre-fix this path returned 500
    // INTERNAL because scopedDb's constructor throw fell through
    // to the generic catch in `role.ts` (bughunter bug_006).
    const db = freshDb();
    seedOrg(db, 'org-a');
    const actor = seedActor(db, 'clerk_actor_noorg', {
      id: 'u_actor_noorg',
      role: 'member',
      orgId: null,
    });
    const someTarget = seedUser(db, {
      id: 'u_target_anyorg',
      role: 'member',
      orgId: 'org-a',
    });

    mockedVerifyToken.mockResolvedValueOnce({
      sub: actor.clerkSubjectId,
    } as unknown as Awaited<ReturnType<typeof verifyToken>>);

    const app = buildApp(db);

    const res = await app.request(
      `/api/v1/users/${someTarget.id}/role`,
      {
        method: 'PATCH',
        headers: {
          cookie: '__session=valid',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ role: 'team_admin' }),
      },
      env,
    );

    expect(res.status).toBe(403);
    const body = (await res.json()) as {
      success: boolean;
      error: { code: string; message: string };
    };
    expect(body).toMatchObject({
      success: false,
      error: { code: 'FORBIDDEN' },
    });
  });
});
