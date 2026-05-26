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
 *   3. The skip gate checks BOTH `CLERK_SECRET_KEY` AND that the
 *      personas JSON is populated. The integration test is meaningful
 *      only when both inputs exist; a partial bootstrap (env var set
 *      but personas JSON still all-null) MUST skip rather than fail —
 *      otherwise coverage-capture runs in CI environments that export
 *      a `CLERK_SECRET_KEY` placeholder would surface as test failures
 *      rather than as the operator's actual bootstrap task.
 */

import { describe, expect, it } from 'vitest';

import { readPersonaClerkIds } from './clerkPersonas';
import {
  DEFAULT_SIGN_IN_TICKET_TTL_SECONDS,
  mintSignInTicket,
} from './clerkTickets';

/**
 * Compute the skip gate once at module-load time. The gate is true (skip)
 * unless BOTH:
 *
 *   - `process.env.CLERK_SECRET_KEY` is non-empty, AND
 *   - `readPersonaClerkIds()` resolves without throwing (i.e. every
 *     persona has a populated subject ID per the bootstrap runbook).
 *
 * Either input alone is insufficient — minting tickets needs both.
 */
function shouldSkipIntegrationSuite(): boolean {
  if (!process.env.CLERK_SECRET_KEY) {
    return true;
  }
  try {
    readPersonaClerkIds();
    return false;
  } catch {
    // Personas JSON not populated yet — skip. The reader's error is
    // already actionable for the operator; surfacing it as a test
    // failure here is noise.
    return true;
  }
}

const SKIP = shouldSkipIntegrationSuite();

describe('mintSignInTicket — integration against real Clerk Test instance', () => {
  it.skipIf(SKIP)(
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

  it.skipIf(SKIP)(
    'mints a sign-in ticket for the coach persona',
    async () => {
      const result = await mintSignInTicket({ persona: 'coach' });

      expect(typeof result.ticket).toBe('string');
      expect(result.ticket.length).toBeGreaterThan(0);
      expect(result.userId).toMatch(/^user_/);
    },
    30_000,
  );

  it.skipIf(SKIP)(
    'mints a sign-in ticket for the org-admin persona',
    async () => {
      const result = await mintSignInTicket({ persona: 'org-admin' });

      expect(typeof result.ticket).toBe('string');
      expect(result.ticket.length).toBeGreaterThan(0);
      expect(result.userId).toMatch(/^user_/);
    },
    30_000,
  );

  it.skipIf(SKIP)(
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
