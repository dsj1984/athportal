// apps/api/src/middleware/require-onboarded.contract.test.ts
//
// Contract test for the `requireOnboarded` middleware (Story #563 /
// Task #577).
//
// Pins the wire shape this Story promises across two surfaces:
//
//   1. Gated route + un-onboarded actor → 403 with the canonical
//      ONBOARDING_REQUIRED envelope.
//   2. Gated route + onboarded actor   → 200 with the existing route
//      envelope (here `GET /api/v1/me` is the representative gated
//      handler).
//   3. Exempt routes (`/api/v1/sign-out`, `/api/v1/health`, the gated
//      `/api/v1/_debug/synthetic-failure`) → reach their handlers even
//      for an un-onboarded actor.
//
// Tier: contract. Uses `createTestApp(db, { actor })` to drive the
// production middleware chain (test-auth seam + real
// `requireInternalUser` + real `requireOnboarded`) against an
// ephemeral SQLite seeded with the full onboarding schema. No HTTP
// mock; no Clerk SDK mock. The only seam substituted is the
// JWT-validator stage.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { users } from '@repo/shared/db/schema';
import { type AuthContext, createTestApp } from '@repo/shared/testing';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { type RequireInternalUserEnv, requireInternalUser } from '../middleware/auth';
import { requireOnboarded } from '../middleware/requireOnboarded';
import { meRoute } from '../routes/v1/me';
import { signOutRoute } from '../routes/v1/sign-out';

const MIGRATIONS_DIR = join(__dirname, '../../../../packages/shared/src/db/migrations');

/**
 * Build a fresh in-memory SQLite handle with BOTH migrations applied —
 * the original auth/rbac schema (`0000`) and the Story #555 onboarding
 * delta (`0001`) which introduces `users.age_attested_at`. The gate
 * reads `users.onboarded_at`, present in both, but the production
 * `requireInternalUser` JIT insert path writes `age_attested_at`
 * defaults that fail when only `0000` is applied — so both must run.
 */
function freshOnboardingProdDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  for (const file of ['0000_auth_and_rbac.sql', '0001_onboarding_schema.sql']) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    for (const stmt of sql.split('--> statement-breakpoint').map((s) => s.trim())) {
      if (stmt.length > 0) sqlite.exec(stmt);
    }
  }
  return drizzle(sqlite, { schema: { users } });
}

function actor(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: 'u_test_actor',
    clerkSubjectId: 'user_test_subject',
    email: 'actor@test.invalid',
    role: 'member',
    orgId: null,
    teamId: null,
    ...overrides,
  };
}

interface SeedOpts {
  readonly onboardedAt: Date | null;
}

function seedActor(db: ReturnType<typeof freshOnboardingProdDb>, a: AuthContext, opts: SeedOpts) {
  db.insert(users)
    .values({
      id: a.userId,
      clerkSubjectId: a.clerkSubjectId,
      email: a.email,
      role: a.role,
      orgId: a.orgId,
      teamId: a.teamId,
      onboardedAt: opts.onboardedAt,
      ageAttestedAt: opts.onboardedAt,
    })
    .run();
}

/**
 * Build the contract test harness. Mirrors the production composition
 * order from `apps/api/src/index.ts`:
 *
 *   test-auth seam (createTestApp({ actor })) → requireInternalUser
 *   → exempt routes (sign-out) → requireOnboarded → gated routes (me)
 *
 * Each test mounts the routes it cares about; the harness is just the
 * composition skeleton.
 */
function buildApp(
  db: ReturnType<typeof freshOnboardingProdDb>,
  a: AuthContext,
  mount: (app: Hono<RequireInternalUserEnv>) => void,
) {
  const app = createTestApp(db, { actor: a }) as unknown as Hono<RequireInternalUserEnv>;
  app.use('/api/v1/*', requireInternalUser());
  mount(app);
  return app;
}

describe('requireOnboarded — contract', () => {
  it('returns 403 ONBOARDING_REQUIRED for an un-onboarded actor on a gated route', async () => {
    const db = freshOnboardingProdDb();
    const a = actor();
    seedActor(db, a, { onboardedAt: null });

    const app = buildApp(db, a, (app) => {
      // Exempt routes are mounted BEFORE the gate; this test exercises
      // only the gated surface, so we mount the gate directly here.
      app.use('/api/v1/*', requireOnboarded());
      app.route('/api/v1/me', meRoute);
    });

    const res = await app.request('/api/v1/me', { method: 'GET' });

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      success: false,
      error: { code: 'ONBOARDING_REQUIRED' },
    });
  });

  it('lets an onboarded actor reach the gated /api/v1/me route', async () => {
    const db = freshOnboardingProdDb();
    const a = actor({ role: 'team_admin' });
    seedActor(db, a, { onboardedAt: new Date('2026-05-01T00:00:00.000Z') });

    const app = buildApp(db, a, (app) => {
      app.use('/api/v1/*', requireOnboarded());
      app.route('/api/v1/me', meRoute);
    });

    const res = await app.request('/api/v1/me', { method: 'GET' });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { userId: string; role: string };
    };
    expect(body.success).toBe(true);
    expect(body.data.userId).toBe(a.userId);
    expect(body.data.role).toBe(a.role);
  });

  it('lets an un-onboarded actor reach exempt /api/v1/sign-out (mount order ahead of gate)', async () => {
    const db = freshOnboardingProdDb();
    const a = actor();
    seedActor(db, a, { onboardedAt: null });

    const app = buildApp(db, a, (app) => {
      // Exempt route mounted BEFORE the gate — production mirror.
      app.route('/api/v1/sign-out', signOutRoute);
      app.use('/api/v1/*', requireOnboarded());
    });

    const res = await app.request('/api/v1/sign-out', { method: 'POST' });

    // signOutRoute returns 204 on success — the assertion here is
    // "did not get 403 ONBOARDING_REQUIRED".
    expect(res.status).toBe(204);
  });

  it('lets an un-onboarded caller reach /api/v1/health without traversing the gate', async () => {
    // /api/v1/health is mounted BEFORE clerkAuth in production (anon
    // probe). The harness here proves the same composition pattern:
    // a route mounted before the gate is reachable regardless of the
    // gate's verdict.
    const db = freshOnboardingProdDb();
    const a = actor();
    seedActor(db, a, { onboardedAt: null });

    const app = buildApp(db, a, (app) => {
      app.get('/api/v1/health', (c) => c.json({ ok: true }));
      app.use('/api/v1/*', requireOnboarded());
    });

    const res = await app.request('/api/v1/health', { method: 'GET' });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });

  it('lets an un-onboarded caller reach the gated debug rehearsal endpoint (mount order ahead of gate)', async () => {
    // /api/v1/_debug/synthetic-failure is mounted ahead of clerkAuth
    // in production, so it is also ahead of requireOnboarded. We
    // exercise the same mount-order property here with a stub handler
    // — the synthetic-failure router itself depends on env bindings
    // that are not relevant to the gate's contract.
    const db = freshOnboardingProdDb();
    const a = actor();
    seedActor(db, a, { onboardedAt: null });

    const app = buildApp(db, a, (app) => {
      app.get('/api/v1/_debug/synthetic-failure', (c) => c.json({ ok: true }));
      app.use('/api/v1/*', requireOnboarded());
    });

    const res = await app.request('/api/v1/_debug/synthetic-failure', {
      method: 'GET',
    });

    expect(res.status).toBe(200);
  });
});
