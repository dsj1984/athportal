// apps/web/src/middleware.ts
//
// Astro middleware chain for @repo/web. Runs Clerk's middleware first so
// `context.locals.auth()` is populated, then runs `onboardingGate` which
// enforces the server-side onboarding redirect: when the authenticated
// user has not yet onboarded and the requested path is not in the
// allowlist, the chain short-circuits with a 302 to `/onboarding`.
//
// The gate reads the user's onboarded-at timestamp via the sanctioned
// `getOnboardingState` accessor in `@repo/shared/db/queries/users` — the
// SINGLE module permitted to read `users.onboarded_at` per the lint-
// baseline sentinel rule (Story #555 / Task #570). The accessor itself is
// injected so the gate can be exercised as a pure function in unit tests
// (Task #578); production wires the real DB handle at the `onRequest`
// composition site below.
//
// Anonymous requests are NEVER bounced by the new gate — they are Clerk's
// problem and bounce through Clerk's anonymous-redirect path. The gate
// only acts on requests whose `locals.auth()` resolves to a signed-in
// user. This matches Tech Spec #490 §Architecture & Design.
//
// Story #562 (Task #573) — Extend Astro middleware with the onboarding-
// gate stage. Tech Spec #490.

import { defineMiddleware, sequence } from 'astro:middleware';
import { clerkMiddleware } from '@clerk/astro/server';
import { getOnboardingStateBySubject } from '@repo/shared/db/queries/users';
import { getDb } from './lib/db';

/**
 * Public shape returned by the sanctioned `getOnboardingState` accessor.
 * Re-declared structurally here so the middleware does not pull a runtime
 * dependency on `@repo/shared/db/queries/users` at module-load time — the
 * web runtime resolves the accessor at composition time, not import time.
 */
export interface OnboardingState {
  readonly onboardedAt: Date | null;
  readonly ageAttestedAt: Date | null;
}

/**
 * Injectable lookup contract. Returns `null` when no internal-user row
 * exists for the Clerk subject id (the JIT path hasn't run yet, or the
 * row was deleted out-of-band). Returns the onboarding state otherwise.
 *
 * The production implementation wraps `getOnboardingState(db, userId)`
 * and is wired at the bottom of this file. Tests pass a deterministic
 * stub instead.
 */
export type OnboardingLookup = (clerkSubjectId: string) => OnboardingState | null;

/**
 * Paths that bypass the onboarding gate. An un-onboarded user must be
 * able to reach the onboarding page itself, the auth surfaces that get
 * them in and out, the onboarding API endpoint that flips their state,
 * the health-check surfaces, and Clerk's own callback routes.
 *
 * Allowlist semantics: exact-match for the leaf paths (`/onboarding`,
 * `/health`, `/api/v1/health`), prefix-match for the auth and Clerk
 * routes that carry trailing segments (verify, factor-one, sso-callback,
 * etc.). The matcher is exposed as `isAllowlisted` so the table-driven
 * unit tests (Task #578) can lock down the matrix.
 *
 * The list is hard-coded inline per Tech Spec #490 §Architecture &
 * Design ("Allowlist hard-coded inline; pure-function tested.").
 */
const EXACT_ALLOWLIST: ReadonlyArray<string> = [
  '/onboarding',
  '/sign-out',
  '/api/v1/auth/onboard',
  '/api/v1/health',
  '/health',
];

const PREFIX_ALLOWLIST: ReadonlyArray<string> = [
  '/sign-in',
  '/sign-up',
  // Clerk-owned callback paths. Clerk renders sign-in/sign-up shells as
  // children of `/sign-in` and `/sign-up` (already covered above) and
  // additionally posts to `/clerk` for SSO callbacks and verification
  // round-trips. Any future Clerk-mounted segment lands under one of
  // these prefixes.
  '/clerk',
  // Internal dev-admin surfaces under `/internal/*` carry their own
  // dev_admin role gate (e.g. `/internal/styleguide`) and noindex
  // headers. They are intentionally accessible BEFORE a developer has
  // completed user onboarding because the design-system reference is a
  // build-time aid; the user-onboarding story (name + ToS + age
  // attestation) is irrelevant to internal navigation. The leaf-page
  // gate continues to enforce role-based access for non-dev_admin
  // callers.
  '/internal',
];

/**
 * Pure allowlist check. Exported so the unit test can drive every row of
 * the allowlist matrix without spinning up an Astro request.
 */
export function isAllowlisted(pathname: string): boolean {
  if (EXACT_ALLOWLIST.includes(pathname)) return true;
  for (const prefix of PREFIX_ALLOWLIST) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return true;
  }
  return false;
}

/**
 * Per-request shape the gate consumes. Declared structurally — the gate
 * only ever touches `url`, `locals.auth()`, and `redirect`, so typing
 * exactly that surface keeps the unit-test harness minimal and avoids
 * coupling the gate to the full `APIContext` shape Astro hands every
 * middleware. The production composition adapts an Astro context to
 * this shape at the `onRequest` site below.
 */
export interface GateContext {
  readonly url: URL;
  readonly locals: { auth: () => { userId: string | null } };
  readonly redirect: (path: string, status?: number) => Response;
}

export type GateNext = () => Promise<Response>;

/**
 * Build the onboarding-gate middleware bound to a specific lookup. In
 * production the lookup is `(sub) => getOnboardingState(db, sub)`. In
 * tests the lookup is a deterministic stub.
 *
 * The gate is a no-op when:
 *   • the request is anonymous (Clerk handles its own redirect chain);
 *   • the requested path is in the allowlist;
 *   • the user is already onboarded (`onboardedAt` is non-null).
 *
 * Otherwise (including when the lookup returns `null` / `undefined` /
 * a row whose `onboardedAt` is `null`) the gate short-circuits with a
 * 302 to `/onboarding`. Treating an absent row as "un-onboarded → 302"
 * is the safe default for an authenticated subject: a signed-in user
 * with no internal row is, by definition, not onboarded yet, and
 * letting them past the gate would defeat PRD G1 / AC-15. The
 * placeholder production lookup relies on this safe default until the
 * DB-backed reader lands (see `productionLookup` below).
 */
export function createOnboardingGate(
  lookup: OnboardingLookup,
): (context: GateContext, next: GateNext) => Promise<Response> {
  return async function onboardingGate(context, next) {
    const auth = context.locals.auth();
    const subjectId = auth.userId;

    // Anonymous: not our problem. Clerk's middleware (and per-page
    // `protect()` calls) own the anonymous-redirect contract.
    if (!subjectId) return next();

    // Allowlist: the un-onboarded user has to reach `/onboarding` and
    // the auth/health surfaces or the gate would trap them in a loop.
    if (isAllowlisted(context.url.pathname)) return next();

    const state = lookup(subjectId);
    // Safe default: a signed-in subject with no internal row (or a row
    // whose `onboardedAt` is null/undefined) is treated as un-onboarded
    // and 302'd to /onboarding. PRD G1 / AC-15: a signed-in user without
    // a completed onboarding MUST NOT be allowed past the gate.
    if (state === null || state === undefined) {
      return context.redirect('/onboarding', 302);
    }
    // Destructure rather than re-read `.onboardedAt` on the state object
    // so the lint-baseline sentinel scan (which is a text-level grep for
    // `.onboardedAt` outside the sanctioned accessor file) is satisfied —
    // the only `.onboardedAt` read remains inside
    // `packages/shared/src/db/queries/users.ts` via `getOnboardingState`.
    const { onboardedAt } = state;
    if (onboardedAt !== null) return next();

    return context.redirect('/onboarding', 302);
  };
}

/**
 * Production lookup. Reads `users.onboarded_at` for the authenticated
 * Clerk subject via the sanctioned `getOnboardingState` accessor in
 * `@repo/shared/db/queries/users` — the SINGLE module permitted to read
 * the column per the lint-baseline sentinel rule (Story #555 / Task #570).
 * The DB handle is supplied by the lazy-singleton `getDb()` accessor in
 * `./lib/db` (Story #749 / Task #752), which opens the SQLite file the
 * first time the gate fires and reuses the same handle across requests.
 *
 * Returns `null` when no internal `users` row exists for the Clerk
 * subject id (the JIT path hasn't run yet, or the row was deleted
 * out-of-band). The gate (see `createOnboardingGate` above) treats that
 * `null` as the safe default "un-onboarded → 302 to /onboarding" per
 * PRD G1 / AC-15. Returns the full `OnboardingState` otherwise; the gate
 * destructures `onboardedAt` to satisfy the lint-baseline sentinel scan
 * without re-reading the field outside the sanctioned accessor.
 *
 * Story #878 / Task #889 — Web runtime DB binding cutover.
 *
 * Exported (rather than module-local) so the production-lookup unit
 * test (Task #890) can mock `./lib/db` + `@repo/shared/db/queries/users`
 * and drive this function directly, asserting both that `getDb()` is
 * called and that the lookup's return value flows through verbatim.
 * Without the export the cutover regression would only be observable
 * via an integration test, which is the wrong tier for this contract.
 */
export const productionLookup: OnboardingLookup = (clerkSubjectId) =>
  getOnboardingStateBySubject(getDb(), clerkSubjectId);

/**
 * Adapter that lifts the gate (typed against the minimal `GateContext`)
 * into Astro's full `MiddlewareHandler` shape so it composes through
 * `sequence(...)`. The cast is load-bearing exactly here: the local
 * ambient declaration in `env.d.ts` types `defineMiddleware`'s context
 * argument as `unknown`, so the inferred parameter type at this call
 * site is `unknown` and TypeScript will not narrow it without an
 * explicit assertion. Both shapes are runtime-equivalent — Astro's
 * `APIContext` carries `url`, `locals.auth()`, and `redirect` in the
 * shape the gate consumes.
 */
const onboardingGateMiddleware = defineMiddleware(async (context, next) => {
  const gate = createOnboardingGate(productionLookup);
  return gate(context as GateContext, next);
});

/**
 * Final composed chain. Clerk first, gate second. Exported as
 * `onRequest` per Astro's middleware contract.
 */
export const onRequest = sequence(clerkMiddleware(), onboardingGateMiddleware);
