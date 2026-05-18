import { afterEach, describe, expect, it } from 'vitest';
import { type AuthContext, createTestApp } from './app';
import { closeAllTestDbs, freshDb } from './db';
import { users } from './schema';

afterEach(() => {
  closeAllTestDbs();
});

describe('createTestApp', () => {
  it('returns a Hono app whose .request method routes through the bound DB', async () => {
    const db = freshDb();
    const app = createTestApp(db);
    const res = await app.request('/__test/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('exposes the bound DB on c.var.db', async () => {
    const db = freshDb();
    db.insert(users)
      .values({
        id: 'u_1',
        clerkId: 'clerk_1',
        email: 'ctx-1@example.invalid',
      })
      .run();
    const app = createTestApp(db);
    app.get('/__test/db-echo', (c) => {
      const all = c.var.db.select().from(users).all();
      return c.json({ count: all.length, email: all[0]?.email ?? null });
    });
    const res = await app.request('/__test/db-echo');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ count: 1, email: 'ctx-1@example.invalid' });
  });

  it('writes the supplied actor to c.var.auth on every request when { actor } is supplied', async () => {
    const db = freshDb();
    const actor: AuthContext = {
      userId: 'u_actor_1',
      clerkSubjectId: 'user_test_actor_1',
      email: 'actor-1@example.invalid',
      role: 'member',
      orgId: null,
      teamId: null,
    };
    const app = createTestApp(db, { actor });
    app.get('/__test/auth-echo', (c) => c.json(c.var.auth));
    const res = await app.request('/__test/auth-echo');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(actor);
  });

  it('writes the actor.clerkSubjectId to c.var.clerkSubjectId so downstream readers see a consistent view', async () => {
    const db = freshDb();
    const actor: AuthContext = {
      userId: 'u_actor_2',
      clerkSubjectId: 'user_test_actor_2',
      email: 'actor-2@example.invalid',
      role: 'org_admin',
      orgId: 'org_test',
      teamId: null,
    };
    const app = createTestApp(db, { actor });
    app.get('/__test/sub-echo', (c) => c.json({ sub: c.var.clerkSubjectId }));
    const res = await app.request('/__test/sub-echo');
    expect(await res.json()).toEqual({ sub: 'user_test_actor_2' });
  });

  it('rejects an actor missing a userId at compile time', () => {
    // Type-level guard: omitting `userId` (or any other required
    // AuthContext field) MUST fail the build. The `@ts-expect-error`
    // directive itself is the assertion — if a future refactor makes
    // `userId` optional, this comment becomes a "Unused @ts-expect-error
    // directive" error and the test fails.
    const db = freshDb();
    createTestApp(db, {
      // @ts-expect-error — userId is required by AuthContext.
      actor: {
        clerkSubjectId: 'user_test_missing_userid',
        email: 'no-userid@example.invalid',
        role: 'member',
        orgId: null,
        teamId: null,
      },
    });
    // No runtime assertion — the test passes if TypeScript compiles
    // this file with the @ts-expect-error directive consumed (i.e. the
    // line above genuinely produces a type error).
    expect(true).toBe(true);
  });

  it('preserves the legacy single-arg form (no actor, no auth middleware mounted)', async () => {
    // This test pins the additive contract from Story #342 / Task #356:
    // existing callers using `createTestApp(db)` MUST continue to work
    // without `c.var.auth` being magically populated.
    const db = freshDb();
    const app = createTestApp(db);
    app.get('/__test/auth-or-null', (c) => {
      // c.var.auth is unset in the legacy form — Hono returns undefined.
      const auth = (c.var as { auth?: AuthContext }).auth;
      return c.json({ hasAuth: auth !== undefined });
    });
    const res = await app.request('/__test/auth-or-null');
    expect(await res.json()).toEqual({ hasAuth: false });
  });

  it('binds two distinct apps to two distinct DBs without crosstalk', async () => {
    const dbA = freshDb();
    const dbB = freshDb();
    const appA = createTestApp(dbA);
    const appB = createTestApp(dbB);
    dbA
      .insert(users)
      .values({
        id: 'u_a',
        clerkId: 'clerk_a',
        email: 'a@example.invalid',
      })
      .run();
    appA.get('/count', (c) => c.json({ n: c.var.db.select().from(users).all().length }));
    appB.get('/count', (c) => c.json({ n: c.var.db.select().from(users).all().length }));
    const [resA, resB] = await Promise.all([appA.request('/count'), appB.request('/count')]);
    expect(await resA.json()).toEqual({ n: 1 });
    expect(await resB.json()).toEqual({ n: 0 });
  });
});
