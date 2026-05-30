// apps/api/src/routes/webhooks/clerk-user-updated.contract.test.ts
//
// Contract test for POST /webhooks/clerk/user-updated (Story #1054 / F33).
//
// Pins the wire-shape + DB-state invariants:
//
//   1. A missing / wrong signature returns 401 UNAUTHENTICATED with the
//      canonical error envelope. The verifier seam throws and the handler
//      MUST NOT echo the verifier's error detail.
//   2. A verified `user.updated` event for an existing local row writes
//      the new first_name / last_name onto the matching `users` row.
//   3. Empty / whitespace-only Clerk name values normalise to NULL so the
//      roster projection falls back to the email-derived name.
//   4. A verified `user.updated` whose Clerk id matches no local row is
//      200-acked and ignored (no write).
//   5. A verified event of a different type is 200-acked and ignored.
//
// Per `docs/testing-strategy.md` § Contract: uses a real better-sqlite3
// handle backed by the production migrations, mounts the real handler,
// and only mocks the third-party signature verifier (the test-auth seam
// pattern, applied to webhooks). Status-code and DB-state assertions live
// here at the contract tier, not in a `.feature` file.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { users } from '@repo/shared/db/schema';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { Env } from '../../env';
import {
  type ClerkUserUpdatedWebhookEnv,
  clerkUserUpdatedRoute,
} from './clerk-user-updated';
import type { VerifyWebhook } from './clerk-user-updated-shared';

const MIGRATIONS_DIR = join(__dirname, '../../../../../packages/shared/src/db/migrations');
const MIGRATION_FILES = [
  '0000_auth_and_rbac.sql',
  '0001_onboarding_schema.sql',
  '0010_users_name.sql',
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
  return drizzle(sqlite, { schema: { users } });
}

type ProductionDb = ReturnType<typeof freshProductionDb>;

const CLERK_SUBJECT = 'user_clerk_subject_1';
const LOCAL_USER_ID = 'u_local_1';

function seedUser(
  db: ProductionDb,
  overrides: Partial<typeof users.$inferInsert> = {},
): void {
  db.insert(users)
    .values({
      id: LOCAL_USER_ID,
      clerkSubjectId: CLERK_SUBJECT,
      email: 'athlete@test.invalid',
      firstName: null,
      lastName: null,
      role: 'member',
      ...overrides,
    })
    .run();
}

function buildApp(
  db: ProductionDb,
  verifier: VerifyWebhook,
): Hono<ClerkUserUpdatedWebhookEnv> {
  const app = new Hono<ClerkUserUpdatedWebhookEnv>();
  app.use('*', async (c, next) => {
    c.set('db', db as unknown);
    c.set('verifyWebhook', verifier);
    await next();
  });
  app.route('/webhooks/clerk/user-updated', clerkUserUpdatedRoute);
  return app;
}

const ENV: Pick<Env, 'CLERK_WEBHOOK_SIGNING_SECRET'> = {
  CLERK_WEBHOOK_SIGNING_SECRET: 'whsec_test',
};

describe('POST /webhooks/clerk/user-updated — contract', () => {
  it('returns 401 UNAUTHENTICATED when the signature verifier throws', async () => {
    const db = freshProductionDb();
    seedUser(db);
    const verifier: VerifyWebhook = () => Promise.reject(new Error('signature mismatch'));
    const app = buildApp(db, verifier);

    const res = await app.request(
      '/webhooks/clerk/user-updated',
      { method: 'POST', body: JSON.stringify({ type: 'user.updated' }) },
      ENV,
    );

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({
      success: false,
      error: { code: 'UNAUTHENTICATED' },
    });

    // No write on the rejected (unverified) payload.
    const reloaded = db.select().from(users).where(eq(users.id, LOCAL_USER_ID)).all();
    expect(reloaded[0]?.firstName).toBeNull();
    expect(reloaded[0]?.lastName).toBeNull();
  });

  it('writes the new first/last name onto the matching local user row', async () => {
    const db = freshProductionDb();
    seedUser(db, { firstName: 'Stale', lastName: 'Name' });
    const verifier: VerifyWebhook = () =>
      Promise.resolve({
        type: 'user.updated',
        data: { id: CLERK_SUBJECT, first_name: 'Grace', last_name: 'Hopper' },
      });
    const app = buildApp(db, verifier);

    const res = await app.request(
      '/webhooks/clerk/user-updated',
      { method: 'POST', body: '{}' },
      ENV,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true });

    const reloaded = db.select().from(users).where(eq(users.id, LOCAL_USER_ID)).all();
    expect(reloaded[0]?.firstName).toBe('Grace');
    expect(reloaded[0]?.lastName).toBe('Hopper');
  });

  it('normalises an empty / whitespace Clerk name to NULL', async () => {
    const db = freshProductionDb();
    seedUser(db, { firstName: 'Grace', lastName: 'Hopper' });
    const verifier: VerifyWebhook = () =>
      Promise.resolve({
        type: 'user.updated',
        data: { id: CLERK_SUBJECT, first_name: '', last_name: '   ' },
      });
    const app = buildApp(db, verifier);

    const res = await app.request(
      '/webhooks/clerk/user-updated',
      { method: 'POST', body: '{}' },
      ENV,
    );

    expect(res.status).toBe(200);

    const reloaded = db.select().from(users).where(eq(users.id, LOCAL_USER_ID)).all();
    expect(reloaded[0]?.firstName).toBeNull();
    expect(reloaded[0]?.lastName).toBeNull();
  });

  it('200-ignores a verified update whose Clerk id matches no local row', async () => {
    const db = freshProductionDb();
    seedUser(db);
    const verifier: VerifyWebhook = () =>
      Promise.resolve({
        type: 'user.updated',
        data: { id: 'user_stranger', first_name: 'Mallory', last_name: 'Forge' },
      });
    const app = buildApp(db, verifier);

    const res = await app.request(
      '/webhooks/clerk/user-updated',
      { method: 'POST', body: '{}' },
      ENV,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, ignored: true });

    // The seeded local row is untouched.
    const reloaded = db.select().from(users).where(eq(users.id, LOCAL_USER_ID)).all();
    expect(reloaded[0]?.firstName).toBeNull();
  });

  it('200-acks and ignores a verified event of a different type', async () => {
    const db = freshProductionDb();
    seedUser(db, { firstName: 'Grace', lastName: 'Hopper' });
    const verifier: VerifyWebhook = () =>
      Promise.resolve({
        type: 'user.created',
        data: { id: CLERK_SUBJECT, first_name: 'Ignored', last_name: 'Ignored' },
      });
    const app = buildApp(db, verifier);

    const res = await app.request(
      '/webhooks/clerk/user-updated',
      { method: 'POST', body: '{}' },
      ENV,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, ignored: true });

    // Other event types do not write — the existing name survives.
    const reloaded = db.select().from(users).where(eq(users.id, LOCAL_USER_ID)).all();
    expect(reloaded[0]?.firstName).toBe('Grace');
  });
});
