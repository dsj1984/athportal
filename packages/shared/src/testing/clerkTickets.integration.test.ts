/**
 * Integration test for `mintSignInTicket()` — Story #881 / Task #896.
 *
 * This test makes a **real** HTTP call to Clerk's `/v1/sign_in_tokens`
 * endpoint, so it requires:
 *
 *   - `CLERK_SECRET_KEY` set to a valid `sk_test_…` secret for a Clerk
 *     Test instance.
 *   - `packages/shared/src/testing/clerk-personas.json` populated per
 *     `docs/runbooks/clerk-persona-bootstrap.md` (every persona key set
 *     to a real `user_…` subject ID).
 *
 * Both inputs come from the Clerk **Test** instance only. CI runs this
 * file with `CLERK_SECRET_KEY` unset, so the `skipIf` below ensures the
 * file is collected but every case is reported as skipped — green build,
 * no live API calls, no secrets required in CI by default.
 *
 * Why `risk::high`. This is the test that proves the runner's load-
 * bearing security boundary (`sk_test_` enforcement, no persistence of
 * the minted ticket) survives contact with real Clerk infrastructure.
 * Reviewers MUST confirm before merge:
 *
 *   1. No password is sent to Clerk; only the subject ID + secret key.
 *   2. The returned ticket is never written to disk or logged in CI.
 *   3. `it.skipIf(!process.env.CLERK_SECRET_KEY)` is the **only** gate,
 *      and the gate is checked on the raw env var (not on a `sk_test_`
 *      prefix) so a misconfigured `sk_live_` value still triggers the
 *      guard in `mintSignInTicket` rather than being silently skipped.
 */

import { describe, expect, it } from 'vitest';

import { DEFAULT_SIGN_IN_TICKET_TTL_SECONDS, mintSignInTicket } from './clerkTickets';

const CLERK_SECRET_KEY_PRESENT = Boolean(process.env.CLERK_SECRET_KEY);

describe('mintSignInTicket — integration against real Clerk Test instance', () => {
  it.skipIf(!CLERK_SECRET_KEY_PRESENT)(
    'mints a sign-in ticket for the athlete persona',
    async () => {
      const result = await mintSignInTicket({ persona: 'athlete' });

      expect(typeof result.ticket).toBe('string');
      expect(result.ticket.length).toBeGreaterThan(0);
      expect(result.userId).toMatch(/^user_/);
      expect(result.expiresInSeconds).toBe(DEFAULT_SIGN_IN_TICKET_TTL_SECONDS);
    },
    30_000,
  );

  it.skipIf(!CLERK_SECRET_KEY_PRESENT)(
    'mints a sign-in ticket for the coach persona',
    async () => {
      const result = await mintSignInTicket({ persona: 'coach' });

      expect(typeof result.ticket).toBe('string');
      expect(result.ticket.length).toBeGreaterThan(0);
      expect(result.userId).toMatch(/^user_/);
    },
    30_000,
  );

  it.skipIf(!CLERK_SECRET_KEY_PRESENT)(
    'mints a sign-in ticket for the org-admin persona',
    async () => {
      const result = await mintSignInTicket({ persona: 'org-admin' });

      expect(typeof result.ticket).toBe('string');
      expect(result.ticket.length).toBeGreaterThan(0);
      expect(result.userId).toMatch(/^user_/);
    },
    30_000,
  );

  it.skipIf(!CLERK_SECRET_KEY_PRESENT)(
    'honours a custom expiresInSeconds value',
    async () => {
      const result = await mintSignInTicket({
        persona: 'athlete',
        expiresInSeconds: 60,
      });

      expect(result.expiresInSeconds).toBe(60);
      expect(typeof result.ticket).toBe('string');
    },
    30_000,
  );
});
