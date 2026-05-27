// apps/api/src/routes/debug/create-test-user.contract.test.ts
//
// Contract test for the gated dev-only `POST /api/v1/_debug/create-test-user`
// route (Story #963). Locks the wire contract the Playwright fresh-user
// fixture depends on:
//
//   1. Gate closed → every verb returns 404 with the standard 404
//      envelope. No 403, no 405 — disclosure of the route's existence
//      would defeat the "indistinguishable from a non-existent route"
//      contract that `synthetic-failure.ts` established for the
//      `/api/v1/_debug/*` namespace.
//
//   2. Gate open + malformed body → 400 with the Zod-shaped error
//      envelope (`code: 'INVALID_BODY'`, `details[]`).
//
//   3. Gate open + non-`+clerk_test@` email → 400 from the Zod refine.
//      The shared `createTestUser` helper only WARNS on this, but the
//      route refuses because a non-test email cannot retrieve a
//      verification code and a Playwright fixture using such an email
//      would wedge forever.
//
//   4. Gate open + missing/non-test `CLERK_SECRET_KEY` → 503 with
//      `code: 'MISCONFIGURED_INSTANCE'`. The shared helper's
//      `assertClerkTestSecretKey` throws synchronously; the route
//      translates that into a stable envelope so the fixture sees a
//      useful message rather than a stack trace.
//
//   5. Gate open + happy path → 200 with
//      `{ success: true, data: { userId, email, emailVerified,
//         password, signInTicket, signInTicketExpiresInSeconds } }`.
//      The Clerk Backend SDK is mocked at module-load so the test does
//      not touch the network. The mock asserts the helper was called
//      with `skipPasswordChecks: true` and that `createSignInToken`
//      was called with `expiresInSeconds: 30` (the ticket-TTL clamp).
//
// Tier: contract. Status codes, response bodies, and error envelopes
// are the contract surface — exactly what `testing-standards.md`
// § Contract names as in-scope for this tier.

import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock hoists, so the stubs are in place before the route module's
// import side-effects run. Both Clerk surfaces the route touches are
// faked at the module boundary:
//
//   - `@clerk/backend.createClerkClient` is the SDK constructor; we
//     return a stub whose `users.createUser`, `emailAddresses.createEmailAddress`,
//     and `signInTokens.createSignInToken` methods are spied on.
//   - The shared helper module is the upstream consumer of that
//     constructor — its own `clerkFactory` injection seam is what we
//     hijack indirectly here, so the test exercises the real
//     `createTestUser` body end-to-end.
const createUserMock = vi.fn();
const createEmailAddressMock = vi.fn();
const createSignInTokenMock = vi.fn();

vi.mock('@clerk/backend', () => ({
  createClerkClient: () => ({
    users: { createUser: createUserMock },
    emailAddresses: { createEmailAddress: createEmailAddressMock },
    signInTokens: { createSignInToken: createSignInTokenMock },
  }),
}));

import { type CreateTestUserDebugEnv, createTestUserDebugRoute } from './create-test-user';

function createApp(): Hono<{ Bindings: CreateTestUserDebugEnv }> {
  const app = new Hono<{ Bindings: CreateTestUserDebugEnv }>();
  app.route('/api/v1/_debug/create-test-user', createTestUserDebugRoute);
  return app;
}

const VALID_TEST_KEY = 'sk_test_canned_for_contract_suite';
const VALID_EMAIL = 'fresh-user+clerk_test@example.com';

beforeEach(() => {
  createUserMock.mockReset();
  createEmailAddressMock.mockReset();
  createSignInTokenMock.mockReset();

  // Default happy-path stub returns. Tests that need a failure mode
  // override these per-case.
  createUserMock.mockResolvedValue({
    id: 'user_test_freshly_minted',
    primaryEmailAddressId: 'idn_test',
  });
  createSignInTokenMock.mockResolvedValue({
    token: 'tic_abc123',
    userId: 'user_test_freshly_minted',
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /api/v1/_debug/create-test-user — gate closed', () => {
  it('returns 404 when DEBUG_TEST_USER_CREATION_ENABLED is unset', async () => {
    const app = createApp();
    const res = await app.request(
      '/api/v1/_debug/create-test-user',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: VALID_EMAIL }),
      },
      { CLERK_SECRET_KEY: VALID_TEST_KEY } satisfies CreateTestUserDebugEnv,
    );

    expect(res.status).toBe(404);
    expect(res.status).not.toBe(403);
    const body = (await res.json()) as unknown;
    expect(body).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
    expect(createUserMock).not.toHaveBeenCalled();
    expect(createSignInTokenMock).not.toHaveBeenCalled();
  });

  it('returns 404 when the gate is the literal string "false"', async () => {
    const app = createApp();
    const res = await app.request(
      '/api/v1/_debug/create-test-user',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: VALID_EMAIL }),
      },
      {
        DEBUG_TEST_USER_CREATION_ENABLED: 'false',
        CLERK_SECRET_KEY: VALID_TEST_KEY,
      } satisfies CreateTestUserDebugEnv,
    );

    expect(res.status).toBe(404);
    expect(createUserMock).not.toHaveBeenCalled();
  });

  it('returns 404 on GET (unsupported verb) even when the gate is open', async () => {
    // Verb mismatch on a gated debug route is still a 404, not a 405 —
    // mirrors synthetic-failure's exposure-surface contract.
    const app = createApp();
    const res = await app.request('/api/v1/_debug/create-test-user', { method: 'GET' }, {
      DEBUG_TEST_USER_CREATION_ENABLED: 'true',
      CLERK_SECRET_KEY: VALID_TEST_KEY,
    } satisfies CreateTestUserDebugEnv);

    expect(res.status).toBe(404);
  });
});

describe('POST /api/v1/_debug/create-test-user — gate open, body validation', () => {
  it('returns 400 INVALID_BODY when the request body is missing fields', async () => {
    const app = createApp();
    const res = await app.request(
      '/api/v1/_debug/create-test-user',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      },
      {
        DEBUG_TEST_USER_CREATION_ENABLED: 'true',
        CLERK_SECRET_KEY: VALID_TEST_KEY,
      } satisfies CreateTestUserDebugEnv,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      success: boolean;
      error: { code: string; details: ReadonlyArray<{ path: string[]; message: string }> };
    };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INVALID_BODY');
    expect(body.error.details.length).toBeGreaterThan(0);
    expect(body.error.details.some((d) => d.path.includes('email'))).toBe(true);
    expect(createUserMock).not.toHaveBeenCalled();
  });

  it('returns 400 when the email is not a +clerk_test@ address', async () => {
    // The Zod refine refuses non-test-channel emails defensively — the
    // shared helper only warns on this, but the route is the contract
    // boundary the Playwright fixture sees.
    const app = createApp();
    const res = await app.request(
      '/api/v1/_debug/create-test-user',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'not-a-test-channel@example.com' }),
      },
      {
        DEBUG_TEST_USER_CREATION_ENABLED: 'true',
        CLERK_SECRET_KEY: VALID_TEST_KEY,
      } satisfies CreateTestUserDebugEnv,
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error: { code: string; details: ReadonlyArray<{ path: string[]; message: string }> };
    };
    expect(body.error.code).toBe('INVALID_BODY');
    expect(body.error.details.some((d) => d.path.includes('email'))).toBe(true);
    expect(createUserMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/v1/_debug/create-test-user — gate open, env gating', () => {
  it('returns 503 MISCONFIGURED_INSTANCE when CLERK_SECRET_KEY is missing', async () => {
    const app = createApp();
    const res = await app.request(
      '/api/v1/_debug/create-test-user',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: VALID_EMAIL }),
      },
      { DEBUG_TEST_USER_CREATION_ENABLED: 'true' } satisfies CreateTestUserDebugEnv,
    );

    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('MISCONFIGURED_INSTANCE');
    expect(createUserMock).not.toHaveBeenCalled();
  });

  it('returns 503 when CLERK_SECRET_KEY is sk_live_', async () => {
    // Defence-in-depth: the route must refuse non-test keys at the
    // wire boundary even though the shared helper also refuses. A
    // failure here would mean the helper is being called with the
    // wrong key, which is the exact security boundary
    // `assertClerkTestSecretKey` guards.
    const app = createApp();
    const res = await app.request(
      '/api/v1/_debug/create-test-user',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: VALID_EMAIL }),
      },
      {
        DEBUG_TEST_USER_CREATION_ENABLED: 'true',
        CLERK_SECRET_KEY: 'sk_live_forbidden_in_this_path',
      } satisfies CreateTestUserDebugEnv,
    );

    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('MISCONFIGURED_INSTANCE');
    expect(createUserMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/v1/_debug/create-test-user — gate open, happy path', () => {
  it('returns 200 with the freshly minted user + sign-in ticket', async () => {
    const app = createApp();
    const res = await app.request(
      '/api/v1/_debug/create-test-user',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: VALID_EMAIL,
          firstName: 'Ada',
          lastName: 'Lovelace',
        }),
      },
      {
        DEBUG_TEST_USER_CREATION_ENABLED: 'true',
        CLERK_SECRET_KEY: VALID_TEST_KEY,
      } satisfies CreateTestUserDebugEnv,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: {
        userId: string;
        email: string;
        emailVerified: boolean;
        password: string;
        signInTicket: string;
        signInTicketExpiresInSeconds: number;
      };
    };
    expect(body.success).toBe(true);
    expect(body.data.userId).toBe('user_test_freshly_minted');
    expect(body.data.email).toBe(VALID_EMAIL);
    expect(body.data.emailVerified).toBe(true);
    expect(typeof body.data.password).toBe('string');
    expect(body.data.password.length).toBeGreaterThan(0);
    expect(body.data.signInTicket).toBe('tic_abc123');
    expect(body.data.signInTicketExpiresInSeconds).toBe(30);

    // The shared helper went down the verified path — single users.createUser
    // call, no separate email-address create.
    expect(createUserMock).toHaveBeenCalledTimes(1);
    const createUserArg = createUserMock.mock.calls[0]?.[0] as {
      emailAddress: string[];
      firstName?: string;
      lastName?: string;
      skipPasswordChecks: boolean;
    };
    expect(createUserArg.emailAddress).toEqual([VALID_EMAIL]);
    expect(createUserArg.firstName).toBe('Ada');
    expect(createUserArg.lastName).toBe('Lovelace');
    expect(createUserArg.skipPasswordChecks).toBe(true);
    expect(createEmailAddressMock).not.toHaveBeenCalled();

    // The ticket TTL is clamped at the route layer.
    expect(createSignInTokenMock).toHaveBeenCalledTimes(1);
    expect(createSignInTokenMock.mock.calls[0]?.[0]).toEqual({
      userId: 'user_test_freshly_minted',
      expiresInSeconds: 30,
    });
  });

  it('routes through the unverified branch when emailVerified is false', async () => {
    const app = createApp();
    createEmailAddressMock.mockResolvedValue({ id: 'idn_unverified' });

    const res = await app.request(
      '/api/v1/_debug/create-test-user',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: VALID_EMAIL, emailVerified: false }),
      },
      {
        DEBUG_TEST_USER_CREATION_ENABLED: 'true',
        CLERK_SECRET_KEY: VALID_TEST_KEY,
      } satisfies CreateTestUserDebugEnv,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { emailVerified: boolean } };
    expect(body.data.emailVerified).toBe(false);

    // Verified branch: createUser was called without an emailAddress
    // entry; the email is created separately via emailAddresses.create.
    expect(createUserMock).toHaveBeenCalledTimes(1);
    const createUserArg = createUserMock.mock.calls[0]?.[0] as { emailAddress?: string[] };
    expect(createUserArg.emailAddress).toBeUndefined();
    expect(createEmailAddressMock).toHaveBeenCalledTimes(1);
  });

  it('returns 502 CREATE_FAILED when Clerk createUser throws', async () => {
    createUserMock.mockRejectedValue(new Error('email already exists'));

    const app = createApp();
    const res = await app.request(
      '/api/v1/_debug/create-test-user',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: VALID_EMAIL }),
      },
      {
        DEBUG_TEST_USER_CREATION_ENABLED: 'true',
        CLERK_SECRET_KEY: VALID_TEST_KEY,
      } satisfies CreateTestUserDebugEnv,
    );

    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('CREATE_FAILED');
    expect(body.error.message).toMatch(/email already exists/);
    expect(createSignInTokenMock).not.toHaveBeenCalled();
  });

  it('returns 502 TICKET_MINT_FAILED when Clerk signInTokens.create throws', async () => {
    createSignInTokenMock.mockRejectedValue(new Error('clerk 429 rate limited'));

    const app = createApp();
    const res = await app.request(
      '/api/v1/_debug/create-test-user',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: VALID_EMAIL }),
      },
      {
        DEBUG_TEST_USER_CREATION_ENABLED: 'true',
        CLERK_SECRET_KEY: VALID_TEST_KEY,
      } satisfies CreateTestUserDebugEnv,
    );

    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('TICKET_MINT_FAILED');
    expect(body.error.message).toMatch(/rate limited/);
  });
});
