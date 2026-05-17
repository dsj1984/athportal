import { afterEach, describe, expect, it } from 'vitest';
import { createTestApp } from './app';
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
    await db
      .insert(users)
      .values({
        id: 'u_1',
        clerkId: 'clerk_1',
        email: 'ctx-1@example.invalid',
      })
      .run();
    const app = createTestApp(db);
    app.get('/__test/db-echo', async (c) => {
      const all = await c.var.db.select().from(users).all();
      return c.json({ count: all.length, email: all[0]?.email ?? null });
    });
    const res = await app.request('/__test/db-echo');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ count: 1, email: 'ctx-1@example.invalid' });
  });

  it('binds two distinct apps to two distinct DBs without crosstalk', async () => {
    const dbA = freshDb();
    const dbB = freshDb();
    const appA = createTestApp(dbA);
    const appB = createTestApp(dbB);
    await dbA
      .insert(users)
      .values({
        id: 'u_a',
        clerkId: 'clerk_a',
        email: 'a@example.invalid',
      })
      .run();
    appA.get('/count', async (c) =>
      c.json({ n: (await c.var.db.select().from(users).all()).length }),
    );
    appB.get('/count', async (c) =>
      c.json({ n: (await c.var.db.select().from(users).all()).length }),
    );
    const [resA, resB] = await Promise.all([
      appA.request('/count'),
      appB.request('/count'),
    ]);
    expect(await resA.json()).toEqual({ n: 1 });
    expect(await resB.json()).toEqual({ n: 0 });
  });
});
