import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestApp } from './app';
import { PERSONA_FIXTURES, authHeaders, requireTestUserPassword, resolvePersona } from './auth';
import { closeAllTestDbs, freshDb } from './db';
import { seedUser } from './seeds';

afterEach(() => {
  closeAllTestDbs();
});

// `signInAs` itself drives a live Playwright `page` against the Clerk
// test instance, so it is exercised at the acceptance tier rather than
// here. This file covers the pure surface: `authHeaders` (contract
// tier), `resolvePersona`, the `PERSONA_FIXTURES` mapping invariants,
// and the `CLERK_TEST_USER_PASSWORD` env-var contract.

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

  it('uses @example.com emails for every persona', () => {
    // Clerk rejects the `.invalid` TLD at the email-validation boundary,
    // so persona fixtures use `@example.com` (RFC 2606 reserved for
    // documentation) instead. The contract-tier synthetic-PII guard
    // (`safety.ts`) still pins `.invalid` for DB seeds.
    for (const fixture of Object.values(PERSONA_FIXTURES)) {
      expect(fixture.email.endsWith('@example.com')).toBe(true);
    }
  });
});

describe('requireTestUserPassword', () => {
  beforeEach(() => {
    vi.stubEnv('CLERK_TEST_USER_PASSWORD', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns the env value when set', () => {
    vi.stubEnv('CLERK_TEST_USER_PASSWORD', 'sentinel-password');
    expect(requireTestUserPassword()).toBe('sentinel-password');
  });

  it('throws when the env value is empty', () => {
    expect(() => requireTestUserPassword()).toThrow(/CLERK_TEST_USER_PASSWORD/);
  });
});
