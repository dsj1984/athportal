// apps/api/src/routes/debug/synthetic-failure.ts
//
// Gated synthetic-failure rehearsal endpoint (Story #275, Tech Spec #246
// § "Synthetic-failure endpoint exposure surface").
//
// The runbook procedure at `docs/ops/observability-runbook.md` §
// "Synthetic-failure rehearsal" is the only sanctioned way to flip the
// `OBSERVABILITY_SYNTHETIC_FAILURE_ENABLED` Workers secret. When the flag
// is the literal string 'true', a POST against this route throws a
// module-private `SyntheticFailureError`, the error is captured by
// `@sentry/cloudflare`'s `captureException`, and the Sentry alert rule
// downstream fires into the operator-email distribution list. The rest
// of the time the route is indistinguishable from a non-existent path —
// the gate returns 404 (NEVER 403, which would disclose existence).
//
// Three invariants this module guarantees, all locked by the contract
// test at `./synthetic-failure.contract.test.ts`:
//
//   1. Gate closed → every verb returns 404 with the standard error
//      envelope. No 403, no 405.
//   2. Gate open + POST → throws SyntheticFailureError; that throw is
//      handed to Sentry's captureException exactly once.
//   3. SyntheticFailureError is module-private: the class is defined
//      inside this file and is NOT exported. Only the route handler can
//      construct one. (Production code outside this module that wants
//      to "test the alert path" must use the runbook procedure instead.)
//
// The Hono error pipeline turns the throw into a 5xx response by
// default; that response shape is not part of this module's contract
// because the rehearsal procedure cares about the Sentry alert, not the
// HTTP body. Operators read the alert in their inbox.

import { captureException } from '@sentry/cloudflare';
import { Hono } from 'hono';

/**
 * Environment bindings this route reads. Only the synthetic-failure
 * gate is consulted here; the wider Worker binding surface (Analytics
 * Engine, Sentry DSN, release SHA) is owned by the request-logger
 * middleware and the Sentry init wrapper respectively.
 *
 * The gate is read as a string and compared to the literal `'true'`.
 * Any other value — including `'false'`, `'1'`, `'TRUE'`, the empty
 * string, or an unset binding — is the closed state. This is deliberate:
 * the runbook only ever instructs operators to set the value to `true`,
 * and conservative parsing keeps fat-fingered values from accidentally
 * opening the gate.
 */
export interface SyntheticFailureEnv {
  OBSERVABILITY_SYNTHETIC_FAILURE_ENABLED?: string;
}

/**
 * Module-private error class raised when the gate is open and a POST
 * arrives. Defined inside this module and intentionally NOT exported,
 * so no production caller can instantiate it directly. Sentry receives
 * the typed instance via `captureException` so the alert rule (matched
 * by `error.type == 'SyntheticFailureError'` in the Sentry project) can
 * distinguish rehearsal events from real production exceptions.
 */
class SyntheticFailureError extends Error {
  public constructor() {
    super(
      'Synthetic failure rehearsal — this exception was raised intentionally ' +
        'by the gated /api/v1/_debug/synthetic-failure endpoint. ' +
        'If you are seeing this in production, the OBSERVABILITY_SYNTHETIC_FAILURE_ENABLED ' +
        'secret was set in the wrong environment.',
    );
    this.name = 'SyntheticFailureError';
  }
}

/**
 * Standard 404 envelope used by the closed-gate path. Kept inline (not
 * imported from a shared error-envelope module) because no such module
 * exists in the API workspace yet — the first route to need one
 * (Story #275 itself) defines the shape and a follow-on Story can lift
 * it into `@repo/shared` once a second consumer arrives.
 */
const NOT_FOUND_BODY = {
  success: false,
  error: { code: 'NOT_FOUND', message: 'Not Found' },
} as const;

/**
 * Hono sub-app mounted at `/api/v1/_debug/synthetic-failure` by
 * `apps/api/src/index.ts`. Three route handlers cover the surface:
 *
 *   - POST: gate check, throw on open, 404 on closed.
 *   - GET (and `.all`): always 404, even when the gate is open. The
 *     route is POST-only by contract; a GET response that differed from
 *     the closed-gate 404 would disclose the route's existence.
 *
 * The throw is captured by `@sentry/cloudflare` BEFORE it is re-thrown
 * so the Sentry alert path is exercised even if the Worker entry has
 * been wrapped without a top-level error handler. The Hono pipeline
 * still surfaces a 5xx after the throw — that's the request-logger
 * middleware's job — but the alert lands either way.
 */
export const syntheticFailureRoute = new Hono<{ Bindings: SyntheticFailureEnv }>();

syntheticFailureRoute.post('/', (c) => {
  const gate = c.env?.OBSERVABILITY_SYNTHETIC_FAILURE_ENABLED;
  if (gate !== 'true') {
    return c.json(NOT_FOUND_BODY, 404);
  }

  const error = new SyntheticFailureError();
  // Capture eagerly so the Sentry alert path fires even if a future
  // refactor of the Worker entry drops the top-level error boundary.
  // The Hono onError pipeline will also receive the throw below.
  captureException(error);
  throw error;
});

// Catch-all for every other verb so the route stays indistinguishable
// from a non-existent path. Hono would otherwise respond with 404 from
// its own not-found handler — explicit handling here keeps the envelope
// consistent with the gate-closed POST path.
syntheticFailureRoute.all('/', (c) => c.json(NOT_FOUND_BODY, 404));
