/**
 * Unit tests for `clerkTickets.ts` — Story #881 / Task #897.
 *
 * Verifies the load-bearing `sk_test_` env-prefix guard and the happy
 * path through dependency injection. Real Clerk HTTP traffic is covered
 * by the skippable integration test (Task #896); this file mocks
 * `createClerkClient` so it runs offline.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_SIGN_IN_TICKET_TTL_SECONDS,
  MAX_SIGN_IN_TICKET_TTL_SECONDS,
  assertClerkTestSecretKey,
  mintSignInTicket,
} from './clerkTickets';

function fakeClerkClient(returned: { token: string; userId: string }) {
  return {
    signInTokens: {
      createSignInToken: vi.fn(() =>
        Promise.resolve({
          id: 'sit_test_1',
          token: returned.token,
          userId: returned.userId,
          status: 'pending',
          url: '',
          createdAt: 0,
          updatedAt: 0,
        }),
      ),
    },
  };
}

function fakeFactory(returned: { token: string; userId: string }) {
  const client = fakeClerkClient(returned);
  // The real createClerkClient returns a much larger object; we cast to
  // any here only because narrowing the return type to "signInTokens"
  // suffices for these tests.
  const factory = vi.fn(
    () => client as unknown as ReturnType<typeof import('@clerk/backend').createClerkClient>,
  );
  return { factory, client };
}

function stubPersonaReader(userId: string) {
  return () =>
    Object.freeze({
      athlete: userId,
      coach: 'user_test_coach_unused',
      'org-admin': 'user_test_orgadmin_unused',
    });
}

describe('DEFAULT_SIGN_IN_TICKET_TTL_SECONDS', () => {
  it('defaults to 30 seconds — long enough for the runner, short enough to limit blast radius', () => {
    expect(DEFAULT_SIGN_IN_TICKET_TTL_SECONDS).toBe(30);
  });
});

describe('assertClerkTestSecretKey — sk_test_ guard (load-bearing)', () => {
  it('returns the key when it starts with sk_test_', () => {
    expect(assertClerkTestSecretKey('sk_test_abc123')).toBe('sk_test_abc123');
  });

  it('throws when the key is undefined', () => {
    expect(() => assertClerkTestSecretKey(undefined)).toThrow(/CLERK_SECRET_KEY is not set/);
  });

  it('throws when the key is the empty string', () => {
    expect(() => assertClerkTestSecretKey('')).toThrow(/CLERK_SECRET_KEY is not set/);
  });

  it('throws when the key starts with sk_live_', () => {
    expect(() => assertClerkTestSecretKey('sk_live_dangerous')).toThrow(
      /must start with 'sk_test_'/,
    );
  });

  it('throws when the key has any other prefix', () => {
    expect(() => assertClerkTestSecretKey('pk_test_publishable')).toThrow(
      /must start with 'sk_test_'/,
    );
  });

  it('throws with the wrong-prefix message even when the suffix would look valid', () => {
    expect(() => assertClerkTestSecretKey('sk_live_test_lookalike')).toThrow(
      /must start with 'sk_test_'/,
    );
  });

  it('echoes only the first 3 characters of the key in the wrong-prefix error', () => {
    try {
      assertClerkTestSecretKey('sk_live_super_secret_dangerous_key_payload');
    } catch (err) {
      const message = (err as Error).message;
      // The hint must be three chars. The full secret must NOT appear.
      expect(message).toContain("'sk_…'");
      expect(message).not.toContain('super_secret');
      expect(message).not.toContain('dangerous_key_payload');
      return;
    }
    throw new Error('expected assertClerkTestSecretKey to throw');
  });
});

describe('mintSignInTicket — guard refuses to run without sk_test_', () => {
  it('throws BEFORE calling the Clerk factory when secretKey is empty', async () => {
    // Passing '' bypasses the destructuring default (`secretKey = process.env[...]`)
    // and exercises the "missing key" branch deterministically — regardless
    // of whether the test runner has CLERK_SECRET_KEY exported.
    const { factory } = fakeFactory({ token: 'unused', userId: 'unused' });

    await expect(
      mintSignInTicket({
        persona: 'athlete',
        secretKey: '',
        clerkFactory: factory,
        personaIdsReader: stubPersonaReader('user_test_athlete'),
      }),
    ).rejects.toThrow(/CLERK_SECRET_KEY is not set/);

    expect(factory).not.toHaveBeenCalled();
  });

  it('throws BEFORE calling the Clerk factory when secretKey is sk_live_', async () => {
    const { factory } = fakeFactory({ token: 'unused', userId: 'unused' });

    await expect(
      mintSignInTicket({
        persona: 'athlete',
        secretKey: 'sk_live_dangerous',
        clerkFactory: factory,
        personaIdsReader: stubPersonaReader('user_test_athlete'),
      }),
    ).rejects.toThrow(/must start with 'sk_test_'/);

    expect(factory).not.toHaveBeenCalled();
  });
});

describe('mintSignInTicket — happy path', () => {
  it('mints a ticket for the named persona via the Clerk Backend SDK', async () => {
    const { factory, client } = fakeFactory({
      token: 'sit_token_value',
      userId: 'user_test_athlete_abc',
    });

    const result = await mintSignInTicket({
      persona: 'athlete',
      secretKey: 'sk_test_validkey',
      clerkFactory: factory,
      personaIdsReader: stubPersonaReader('user_test_athlete_abc'),
    });

    expect(result.ticket).toBe('sit_token_value');
    expect(result.userId).toBe('user_test_athlete_abc');
    expect(result.expiresInSeconds).toBe(DEFAULT_SIGN_IN_TICKET_TTL_SECONDS);

    expect(factory).toHaveBeenCalledWith({ secretKey: 'sk_test_validkey' });
    expect(client.signInTokens.createSignInToken).toHaveBeenCalledWith({
      userId: 'user_test_athlete_abc',
      expiresInSeconds: DEFAULT_SIGN_IN_TICKET_TTL_SECONDS,
    });
  });

  it('honours an expiresInSeconds override', async () => {
    const { factory, client } = fakeFactory({
      token: 'sit_token_value',
      userId: 'user_test_coach_xyz',
    });

    const result = await mintSignInTicket({
      persona: 'coach',
      expiresInSeconds: 5,
      secretKey: 'sk_test_validkey',
      clerkFactory: factory,
      // Stub returns athlete=user_test_coach_xyz for any persona; the
      // helper only reads the persona's slot, so this is fine for the test.
      personaIdsReader: () =>
        Object.freeze({
          athlete: 'user_test_athlete_unused',
          coach: 'user_test_coach_xyz',
          'org-admin': 'user_test_orgadmin_unused',
        }),
    });

    expect(result.expiresInSeconds).toBe(5);
    expect(client.signInTokens.createSignInToken).toHaveBeenCalledWith({
      userId: 'user_test_coach_xyz',
      expiresInSeconds: 5,
    });
  });

  it('Story #904: clamps expiresInSeconds to MAX_SIGN_IN_TICKET_TTL_SECONDS when caller overshoots', async () => {
    // A buggy caller passing 86400 (24h) MUST end up with a ticket
    // bounded by the documented 300-second ceiling. The clamp is
    // silent — no throw — so a runaway caller still gets a working
    // ticket, just one with a sensible lifetime.
    const { factory, client } = fakeFactory({
      token: 'sit_token_value',
      userId: 'user_test_athlete_xyz',
    });

    const result = await mintSignInTicket({
      persona: 'athlete',
      expiresInSeconds: 86400, // 24h — well above the 300-second ceiling
      secretKey: 'sk_test_validkey',
      clerkFactory: factory,
      personaIdsReader: () =>
        Object.freeze({
          athlete: 'user_test_athlete_xyz',
          coach: 'user_test_coach_unused',
          'org-admin': 'user_test_orgadmin_unused',
        }),
    });

    expect(result.expiresInSeconds).toBe(MAX_SIGN_IN_TICKET_TTL_SECONDS);
    expect(result.expiresInSeconds).toBe(300);
    // The clamped value MUST also be what the Clerk SDK sees — otherwise
    // the issued ticket still carries the overshoot TTL even though the
    // echo we return looks correct.
    expect(client.signInTokens.createSignInToken).toHaveBeenCalledWith({
      userId: 'user_test_athlete_xyz',
      expiresInSeconds: MAX_SIGN_IN_TICKET_TTL_SECONDS,
    });
  });

  it('Story #904: honours an expiresInSeconds below the ceiling verbatim (no over-clamping)', async () => {
    // A 60-second TTL is below the 300-second ceiling. The clamp MUST
    // NOT touch it — `Math.min(60, 300) === 60`. This pins the lower
    // half of the boundary so a future change to the clamp shape
    // (e.g. accidentally substituting max for min) flips this test red.
    const { factory, client } = fakeFactory({
      token: 'sit_token_value',
      userId: 'user_test_coach_xyz',
    });

    const result = await mintSignInTicket({
      persona: 'coach',
      expiresInSeconds: 60,
      secretKey: 'sk_test_validkey',
      clerkFactory: factory,
      personaIdsReader: () =>
        Object.freeze({
          athlete: 'user_test_athlete_unused',
          coach: 'user_test_coach_xyz',
          'org-admin': 'user_test_orgadmin_unused',
        }),
    });

    expect(result.expiresInSeconds).toBe(60);
    expect(client.signInTokens.createSignInToken).toHaveBeenCalledWith({
      userId: 'user_test_coach_xyz',
      expiresInSeconds: 60,
    });
  });

  it('returns a frozen ticket object so callers cannot mutate the result', async () => {
    const { factory } = fakeFactory({
      token: 'sit_token_value',
      userId: 'user_test_orgadmin_xyz',
    });

    const result = await mintSignInTicket({
      persona: 'org-admin',
      secretKey: 'sk_test_validkey',
      clerkFactory: factory,
      personaIdsReader: () =>
        Object.freeze({
          athlete: 'user_test_athlete_unused',
          coach: 'user_test_coach_unused',
          'org-admin': 'user_test_orgadmin_xyz',
        }),
    });

    expect(Object.isFrozen(result)).toBe(true);
  });
});

describe('mintSignInTicket — propagates persona-reader errors', () => {
  it('re-throws the actionable runbook-linked error when a persona is unpopulated', async () => {
    const { factory } = fakeFactory({ token: 'unused', userId: 'unused' });

    await expect(
      mintSignInTicket({
        persona: 'athlete',
        secretKey: 'sk_test_validkey',
        clerkFactory: factory,
        personaIdsReader: () => {
          throw new Error(
            "readPersonaClerkIds: the following persona(s) are not yet populated in /tmp/clerk-personas.json: 'athlete'. Follow docs/runbooks/clerk-persona-bootstrap.md to create the corresponding Clerk users in the test instance and paste each user's subject ID into the JSON file.",
          );
        },
      }),
    ).rejects.toThrow(/docs\/runbooks\/clerk-persona-bootstrap\.md/);
  });
});
