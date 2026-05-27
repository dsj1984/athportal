// apps/api/src/middleware/auth.real.contract.test.ts
//
// Real-call contract test for `clerkAuth` against the actual
// `@clerk/backend@^3` surface (Story #941).
//
// Why this file exists. The sibling `auth.contract.test.ts` uses
// `vi.mock('@clerk/backend')` at module top — every assertion in that
// file is therefore answered by whatever shape the test author
// hand-rolled into the mock. The `@clerk/backend` v2→v3 envelope
// rename (`{ data, errors }` semantics) shipped without a single
// production-side breakage in our mocked suite, and surfaced in
// manual QA on PR #940 as an opaque 500.
//
// This file deliberately does NOT mock `@clerk/backend`. It executes
// the real `verifyToken` against the test Clerk instance whose secret
// is exported via `CLERK_SECRET_KEY`, so that the *next* major bump of
// `@clerk/backend` either keeps the envelope contract or surfaces here
// at install time rather than in prod.
//
// Skip gate. The suite is `describe.skipIf(...)`-gated on
// `CLERK_SECRET_KEY` (same pattern as
// `packages/shared/src/testing/clerkTickets.integration.test.ts`).
// CI runs this file with `CLERK_SECRET_KEY` unset, so the file is
// collected but every case is reported as skipped — green build, no
// live API calls, no secrets required by default.
//
// Tier: contract. We exercise the wire boundary between our middleware
// and the third-party SDK (envelope shape + HTTP status), per
// `docs/testing-strategy.md` and `.agents/rules/testing-standards.md`.

import { verifyToken } from '@clerk/backend';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { type ClerkAuthEnv, clerkAuth } from './auth';

/**
 * Skip the entire suite when `CLERK_SECRET_KEY` is not set. We do NOT
 * also gate on `sk_test_` here (unlike `mintSignInTicket`), because
 * this test never *mints* a session — it only validates a deliberately
 * invalid token and asserts the SDK's return envelope. A `sk_live_`
 * key would still answer the call shape-correctly; the
 * `mintSignInTicket` guard's blast-radius concerns do not apply.
 */
const SKIP = !process.env.CLERK_SECRET_KEY;

function createApp(): Hono<ClerkAuthEnv> {
  const app = new Hono<ClerkAuthEnv>();
  app.use('*', clerkAuth());
  app.get('/echo', (c) => c.json({ subject: c.get('clerkSubjectId') }));
  return app;
}

const env = {
  CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY ?? '',
  CLERK_PUBLISHABLE_KEY: process.env.CLERK_PUBLISHABLE_KEY ?? '',
  ANALYTICS: { writeDataPoint: () => {} },
};

describe('clerkAuth — real @clerk/backend@^3 envelope contract', () => {
  it.skipIf(SKIP)(
    'verifyToken returns the v3 { errors } envelope for an invalid token (does not throw, does not return undefined data)',
    async () => {
      // Pin the v2→v3 contract: a malformed token MUST come back as
      // `{ errors: [...] }`, never as a thrown rejection and never as
      // `{ data: undefined, errors: undefined }`. The middleware's
      // 401 path depends on this shape.
      const result = await verifyToken('not.a.real.jwt', {
        secretKey: env.CLERK_SECRET_KEY,
      });

      // v3 envelope discriminator.
      expect(result).toHaveProperty('errors');
      const errors = (result as { errors?: unknown }).errors;
      expect(Array.isArray(errors)).toBe(true);
      expect((errors as unknown[]).length).toBeGreaterThan(0);

      // The success-side data field MUST be undefined when errors is set.
      // (If a future major returns a populated `data` alongside `errors`,
      // our middleware's discriminator collapses and this catches it.)
      expect((result as { data?: unknown }).data).toBeUndefined();
    },
    30_000,
  );

  it.skipIf(SKIP)(
    'middleware returns 401 UNAUTHENTICATED end-to-end for an invalid token (real SDK)',
    async () => {
      const app = createApp();

      const res = await app.request(
        '/echo',
        {
          method: 'GET',
          headers: { cookie: '__session=not.a.real.jwt' },
        },
        env,
      );

      // The wire contract: rejected token → 401 with the canonical
      // envelope, NOT a 500 from an uncaught middleware throw.
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({
        success: false,
        error: { code: 'UNAUTHENTICATED', message: 'Authentication required.' },
      });
    },
    30_000,
  );
});
