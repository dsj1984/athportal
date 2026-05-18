import { generateKeyPairSync } from 'node:crypto';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp } from './app';
import {
  PERSONA_FIXTURES,
  authHeaders,
  mintTestingToken,
  resolvePersona,
  sessionCookieFor,
  signInAs,
} from './auth';
import { closeAllTestDbs, freshDb } from './db';
import { seedUser } from './seeds';

afterEach(() => {
  closeAllTestDbs();
});

// The seam pins RS256 because that is the algorithm Clerk's test
// instance accepts. The unit tier generates an ephemeral RSA private key
// once per file so the signing path is exercised end-to-end without
// reaching for a real Clerk dashboard secret.
let TEST_RSA_PRIVATE_KEY_PEM: string;

beforeAll(() => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  TEST_RSA_PRIVATE_KEY_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
});

beforeEach(() => {
  // Provide the ephemeral RSA private key for the unit tier so the seam
  // can mint signed JWTs without leaning on an environment file. The
  // value is synthetic — the Clerk test instance owns the real key.
  process.env.CLERK_TESTING_TOKEN_SIGNING_KEY = TEST_RSA_PRIVATE_KEY_PEM;
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

describe('mintTestingToken', () => {
  it('returns a JWT-shaped string for a known persona', async () => {
    const token = await mintTestingToken('athlete');
    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3);
  });

  it('throws when the testing-token signing key is absent', async () => {
    process.env.CLERK_TESTING_TOKEN_SIGNING_KEY = '';
    await expect(mintTestingToken('athlete')).rejects.toThrow(/CLERK_TESTING_TOKEN_SIGNING_KEY/);
  });

  it('rejects the anonymous persona with a clear error', async () => {
    await expect(mintTestingToken('anonymous')).rejects.toThrow(TypeError);
  });

  it('throws when called with an unknown persona', async () => {
    await expect(mintTestingToken('unknown' as unknown as 'athlete')).rejects.toThrow(TypeError);
  });
});

describe('sessionCookieFor', () => {
  it('produces an HttpOnly + Secure + SameSite=Lax __session cookie', async () => {
    const cookie = await sessionCookieFor('coach');
    expect(cookie.name).toBe('__session');
    expect(typeof cookie.value).toBe('string');
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.secure).toBe(true);
    expect(cookie.sameSite).toBe('Lax');
    expect(cookie.path).toBe('/');
  });
});

describe('signInAs', () => {
  it('returns a StorageState whose cookies include a __session entry signed by the testing-token key', async () => {
    const state = await signInAs('athlete');
    expect(state.cookies).toHaveLength(1);
    const session = state.cookies[0];
    if (!session) throw new Error('expected one cookie');
    expect(session.name).toBe('__session');
    // JWT shape: header.payload.signature
    expect(session.value.split('.')).toHaveLength(3);
    expect(state.origins).toEqual([]);
  });

  it('returns an empty StorageState for the anonymous persona', async () => {
    const state = await signInAs('anonymous');
    expect(state).toEqual({ cookies: [], origins: [] });
  });

  it('throws a TypeError when called with an unknown persona', async () => {
    await expect(signInAs('unknown' as unknown as 'athlete')).rejects.toThrow(TypeError);
  });
});
