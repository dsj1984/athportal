import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { closeAllTestDbs, freshDb } from './db';
import { users } from './schema';

afterEach(() => {
  closeAllTestDbs();
});

describe('freshDb', () => {
  it('returns a distinct DB instance per call', () => {
    const a = freshDb();
    const b = freshDb();
    expect(a).not.toBe(b);
    expect(a.__filename).not.toBe(b.__filename);
  });

  it('puts the backing file inside os.tmpdir()', () => {
    const db = freshDb();
    expect(db.__filename.startsWith(tmpdir())).toBe(true);
    expect(existsSync(db.__filename)).toBe(true);
  });

  it('applies the example schema and allows round-trip writes', async () => {
    const db = freshDb();
    await db
      .insert(users)
      .values({
        id: 'u_1',
        clerkId: 'clerk_1',
        email: 'test-1@example.invalid',
        role: 'org_admin',
      })
      .run();
    const rows = await db.select().from(users).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.email).toBe('test-1@example.invalid');
  });

  it('isolates writes between two calls', async () => {
    const dbA = freshDb();
    const dbB = freshDb();
    await dbA
      .insert(users)
      .values({
        id: 'u_a',
        clerkId: 'clerk_a',
        email: 'a@example.invalid',
      })
      .run();
    const rowsA = await dbA.select().from(users).all();
    const rowsB = await dbB.select().from(users).all();
    expect(rowsA).toHaveLength(1);
    expect(rowsB).toHaveLength(0);
  });

  it('does not collide on filenames when called many times in a tight loop', () => {
    const filenames = new Set<string>();
    for (let i = 0; i < 10; i += 1) {
      const db = freshDb();
      filenames.add(db.__filename);
    }
    expect(filenames.size).toBe(10);
  });
});

describe('closeAllTestDbs', () => {
  it('is idempotent', () => {
    freshDb();
    closeAllTestDbs();
    expect(() => closeAllTestDbs()).not.toThrow();
  });
});
