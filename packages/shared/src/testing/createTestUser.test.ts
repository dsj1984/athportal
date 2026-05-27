/**
 * Unit tests for `createTestUser.ts` — Story #953 / F2.
 *
 * Mirrors the pattern used by `clerkTickets.test.ts`: dependency-inject
 * a fake Clerk client so the suite runs offline. The real Clerk HTTP
 * round-trip is covered by the skippable integration test next to it.
 */

import { describe, expect, it, vi } from 'vitest';

import { createTestUser, isClerkTestChannelEmail } from './createTestUser';

function fakeClerkClient(returned: { userId: string }) {
  const createUser = vi.fn(() =>
    Promise.resolve({
      id: returned.userId,
    }),
  );
  const createEmailAddress = vi.fn(() =>
    Promise.resolve({
      id: 'idn_test_email',
      object: 'email_address',
    }),
  );
  return {
    client: {
      users: { createUser },
      emailAddresses: { createEmailAddress },
    },
    createUser,
    createEmailAddress,
  };
}

function fakeFactory(returned: { userId: string }) {
  const fakes = fakeClerkClient(returned);
  const factory = vi.fn(
    () => fakes.client as unknown as ReturnType<typeof import('@clerk/backend').createClerkClient>,
  );
  return { factory, ...fakes };
}

describe('isClerkTestChannelEmail', () => {
  it.each([
    ['signup+clerk_test@example.com', true],
    ['signup-happy+clerk_test@example.com', true],
    ['ATHLETE+CLERK_TEST@example.com', true],
    ['athlete@example.com', false],
    ['user+clerk@example.com', false],
    ['someone+clerk_testish@example.com', false],
  ])('classifies %s as %s', (email, expected) => {
    expect(isClerkTestChannelEmail(email)).toBe(expected);
  });
});

describe('createTestUser — sk_test_ guard (load-bearing)', () => {
  it('throws BEFORE calling the Clerk factory when secretKey is empty', async () => {
    const { factory } = fakeFactory({ userId: 'user_unused' });

    await expect(
      createTestUser({
        email: 'a+clerk_test@example.com',
        secretKey: '',
        clerkFactory: factory,
      }),
    ).rejects.toThrow(/CLERK_SECRET_KEY is not set/);

    expect(factory).not.toHaveBeenCalled();
  });

  it('throws BEFORE calling the Clerk factory when secretKey is sk_live_', async () => {
    const { factory } = fakeFactory({ userId: 'user_unused' });

    await expect(
      createTestUser({
        email: 'a+clerk_test@example.com',
        secretKey: 'sk_live_dangerous',
        clerkFactory: factory,
      }),
    ).rejects.toThrow(/must start with 'sk_test_'/);

    expect(factory).not.toHaveBeenCalled();
  });
});

describe('createTestUser — verified path (default)', () => {
  it('creates a user with the supplied email via users.createUser', async () => {
    const { factory, createUser, createEmailAddress } = fakeFactory({
      userId: 'user_test_new_xyz',
    });

    const result = await createTestUser({
      email: 'signup+clerk_test@example.com',
      secretKey: 'sk_test_validkey',
      clerkFactory: factory,
    });

    expect(result.userId).toBe('user_test_new_xyz');
    expect(result.email).toBe('signup+clerk_test@example.com');
    expect(result.emailVerified).toBe(true);
    expect(typeof result.password).toBe('string');
    expect(result.password.length).toBeGreaterThan(8);

    expect(factory).toHaveBeenCalledWith({ secretKey: 'sk_test_validkey' });
    expect(createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        emailAddress: ['signup+clerk_test@example.com'],
        skipPasswordChecks: true,
      }),
    );
    // Verified path MUST NOT touch the email-address endpoint.
    expect(createEmailAddress).not.toHaveBeenCalled();
  });

  it('passes firstName and lastName through when supplied', async () => {
    const { factory, createUser } = fakeFactory({ userId: 'user_test_named' });

    await createTestUser({
      email: 'happy+clerk_test@example.com',
      firstName: 'Ada',
      lastName: 'Lovelace',
      secretKey: 'sk_test_validkey',
      clerkFactory: factory,
    });

    expect(createUser).toHaveBeenCalledWith(
      expect.objectContaining({ firstName: 'Ada', lastName: 'Lovelace' }),
    );
  });

  it('returns a frozen result so callers cannot mutate', async () => {
    const { factory } = fakeFactory({ userId: 'user_test_frozen' });

    const result = await createTestUser({
      email: 'frozen+clerk_test@example.com',
      secretKey: 'sk_test_validkey',
      clerkFactory: factory,
    });

    expect(Object.isFrozen(result)).toBe(true);
  });
});

describe('createTestUser — unverified path', () => {
  it('creates user without email, then adds email with verified: false', async () => {
    const { factory, createUser, createEmailAddress } = fakeFactory({
      userId: 'user_test_unverified',
    });

    const result = await createTestUser({
      email: 'unverified+clerk_test@example.com',
      emailVerified: false,
      secretKey: 'sk_test_validkey',
      clerkFactory: factory,
    });

    expect(result.emailVerified).toBe(false);
    expect(result.userId).toBe('user_test_unverified');

    // The createUser call MUST NOT include emailAddress on the
    // unverified path — that would make Clerk auto-verify the email.
    const createUserArg = createUser.mock.calls[0]?.[0] as { emailAddress?: unknown } | undefined;
    expect(createUserArg).toBeDefined();
    expect(createUserArg?.emailAddress).toBeUndefined();

    expect(createEmailAddress).toHaveBeenCalledWith({
      userId: 'user_test_unverified',
      emailAddress: 'unverified+clerk_test@example.com',
      verified: false,
      primary: true,
    });
  });
});

describe('createTestUser — non-test-channel email warning', () => {
  it('warns when the email does not match +clerk_test@ but still proceeds', async () => {
    const { factory } = fakeFactory({ userId: 'user_test_nontest' });
    const warn = vi.fn();

    const result = await createTestUser({
      email: 'real-user@example.com',
      secretKey: 'sk_test_validkey',
      clerkFactory: factory,
      warn,
    });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(/\+clerk_test@/);
    expect(result.userId).toBe('user_test_nontest');
  });

  it('does NOT warn when the email matches +clerk_test@', async () => {
    const { factory } = fakeFactory({ userId: 'user_test_clean' });
    const warn = vi.fn();

    await createTestUser({
      email: 'fresh+clerk_test@example.com',
      secretKey: 'sk_test_validkey',
      clerkFactory: factory,
      warn,
    });

    expect(warn).not.toHaveBeenCalled();
  });
});

describe('createTestUser — custom password', () => {
  it('honours a password override and echoes it back in the result', async () => {
    const { factory, createUser } = fakeFactory({ userId: 'user_test_pw' });

    const result = await createTestUser({
      email: 'pw+clerk_test@example.com',
      password: 'OverridePassw0rd!2026',
      secretKey: 'sk_test_validkey',
      clerkFactory: factory,
    });

    expect(result.password).toBe('OverridePassw0rd!2026');
    expect(createUser).toHaveBeenCalledWith(
      expect.objectContaining({ password: 'OverridePassw0rd!2026' }),
    );
  });
});
