import { afterEach, describe, expect, it } from 'vitest';
import { createTestApp } from './app';
import { authHeaders } from './auth';
import { closeAllTestDbs, freshDb } from './db';
import { seedUser } from './seeds';

afterEach(() => {
  closeAllTestDbs();
});

describe('authHeaders', () => {
  it('returns a Record<string, string> shape', () => {
    const db = freshDb();
    const user = seedUser(db);
    const headers = authHeaders(user);
    for (const [key, value] of Object.entries(headers)) {
      expect(typeof key).toBe('string');
      expect(typeof value).toBe('string');
    }
  });

  it('includes Authorization and x-clerk-user-id headers tied to the user', () => {
    const db = freshDb();
    const user = seedUser(db, { clerkId: 'clerk_specific' });
    const headers = authHeaders(user);
    expect(headers.Authorization).toBe('Bearer test-clerk-token-clerk_specific');
    expect(headers['x-clerk-user-id']).toBe('clerk_specific');
  });

  it('throws when clerkId is missing', () => {
    expect(() => authHeaders({ clerkId: '' })).toThrow(TypeError);
  });

  it('is consumable by Hono.app.request as RequestInit.headers', async () => {
    const db = freshDb();
    const user = seedUser(db);
    const app = createTestApp(db);
    app.get('/__test/who', (c) => {
      const id = c.req.header('x-clerk-user-id') ?? null;
      return c.json({ id });
    });
    const res = await app.request('/__test/who', {
      headers: authHeaders(user),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: user.clerkId });
  });
});
