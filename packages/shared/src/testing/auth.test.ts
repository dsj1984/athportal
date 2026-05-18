import { afterEach, describe, expect, it } from 'vitest';
import { createTestApp } from './app';
import { PERSONA_FIXTURES, authHeaders, resolvePersona, signInAs } from './auth';
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

describe('resolvePersona', () => {
  it('accepts the four canonical Gherkin spellings', () => {
    expect(resolvePersona('athlete').persona).toBe('athlete');
    expect(resolvePersona('coach').persona).toBe('coach');
    expect(resolvePersona('org admin').persona).toBe('org-admin');
    expect(resolvePersona('dev admin').persona).toBe('dev-admin');
  });

  it('accepts the playwright project-key form', () => {
    expect(resolvePersona('org-admin').persona).toBe('org-admin');
    expect(resolvePersona('dev-admin').persona).toBe('dev-admin');
  });

  it('throws a TypeError listing the accepted spellings on unknown labels', () => {
    expect(() => resolvePersona('superuser')).toThrow(TypeError);
    expect(() => resolvePersona('superuser')).toThrow(/Accepted personas/);
  });

  it('rejects non-string labels', () => {
    expect(() => resolvePersona(42 as unknown as string)).toThrow(TypeError);
  });

  it('maps each persona to the documented role', () => {
    expect(PERSONA_FIXTURES.athlete.role).toBe('member');
    expect(PERSONA_FIXTURES.coach.role).toBe('team_admin');
    expect(PERSONA_FIXTURES['org-admin'].role).toBe('org_admin');
    expect(PERSONA_FIXTURES['dev-admin'].role).toBe('dev_admin');
    expect(PERSONA_FIXTURES.anonymous.role).toBeNull();
  });

  it('uses .invalid emails for every persona', () => {
    for (const fixture of Object.values(PERSONA_FIXTURES)) {
      expect(fixture.email.endsWith('@test.invalid')).toBe(true);
    }
  });
});

describe('signInAs (deferred placeholder — see Issue #371)', () => {
  it('returns an empty StorageState for the anonymous persona', async () => {
    const state = await signInAs('anonymous');
    expect(state).toEqual({ cookies: [], origins: [] });
  });

  it.each(['athlete', 'coach', 'org-admin', 'dev-admin'] as const)(
    'throws for the %s persona with a reference to Issue #371',
    async (persona) => {
      await expect(signInAs(persona)).rejects.toThrow(/Issue #371/);
    },
  );

  it('throws a TypeError when called with an unknown persona', async () => {
    await expect(signInAs('unknown' as unknown as 'athlete')).rejects.toThrow(TypeError);
  });
});
