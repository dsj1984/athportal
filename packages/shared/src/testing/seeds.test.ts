import { afterEach, describe, expect, it } from 'vitest';
import { closeAllTestDbs, freshDb } from './db';
import { SyntheticPiiError } from './safety';
import { seedResource, seedUser } from './seeds';

afterEach(() => {
  closeAllTestDbs();
});

describe('seedUser', () => {
  it('throws via the safety guard before touching the DB when a real email is supplied', () => {
    const db = freshDb();
    expect(() => seedUser(db, { email: 'real@example.com' })).toThrowError(SyntheticPiiError);
  });

  it('returns a row whose email matches /^test-.+@example\\.invalid$/ when called with no overrides', () => {
    const db = freshDb();
    const row = seedUser(db);
    expect(row.email).toMatch(/^test-.+@example\.invalid$/);
  });

  it('honors explicit overrides for synthetic fields', () => {
    const db = freshDb();
    const row = seedUser(db, {
      id: 'u_custom',
      clerkId: 'clerk_custom',
      email: 'test-explicit@example.invalid',
      role: 'dev_admin',
    });
    expect(row).toMatchObject({
      id: 'u_custom',
      clerkId: 'clerk_custom',
      email: 'test-explicit@example.invalid',
      role: 'dev_admin',
    });
  });

  it('produces distinct rows across calls', () => {
    const db = freshDb();
    const a = seedUser(db);
    const b = seedUser(db);
    expect(a.id).not.toBe(b.id);
    expect(a.clerkId).not.toBe(b.clerkId);
    expect(a.email).not.toBe(b.email);
  });
});

describe('seedResource', () => {
  it('inserts a resource owned by the supplied user', () => {
    const db = freshDb();
    const owner = seedUser(db);
    const resource = seedResource(db, { ownerId: owner.id });
    expect(resource.ownerId).toBe(owner.id);
    expect(resource.name).toContain(resource.id);
  });

  it('honors explicit name overrides', () => {
    const db = freshDb();
    const owner = seedUser(db);
    const resource = seedResource(db, {
      ownerId: owner.id,
      name: 'Hand-picked Resource',
    });
    expect(resource.name).toBe('Hand-picked Resource');
  });

  it('runs the synthetic-PII guard on overrides too', () => {
    const db = freshDb();
    const owner = seedUser(db);
    // Build the violation as `unknown` first, then cast to the input type so the
    // test exercises the runtime guard without leaking `any` into the file.
    const offending: unknown = {
      ownerId: owner.id,
      meta: { contact: { email: 'leak@example.com' } },
    };
    expect(() => seedResource(db, offending as Parameters<typeof seedResource>[1])).toThrowError(
      SyntheticPiiError,
    );
  });
});
