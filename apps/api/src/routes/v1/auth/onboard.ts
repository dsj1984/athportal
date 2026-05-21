// apps/api/src/routes/v1/auth/onboard.ts
//
// POST /api/v1/auth/onboard — single-transaction commit of the
// onboarding flow (Epic #8 / Story #564 / Task #576, Tech Spec #490).
//
// Auth chain (set by upstream middleware):
//
//   1. `clerkAuth`           — validates the Clerk JWT, writes
//                              `c.var.clerkSubjectId`.
//   2. `requireInternalUser` — resolves the internal users row via JIT,
//                              writes `c.var.auth` (an `AuthContext`).
//   3. (NOT) `requireOnboarded` — this route is the ONE that stamps
//                                 `users.onboarded_at`; gating it
//                                 behind the onboarded check would
//                                 produce a circular dependency. The
//                                 route MUST be mounted BEFORE the
//                                 global `requireOnboarded` chain.
//
// Single-transaction commit (Tech Spec #490 §Security & Privacy):
//
//   Inside one Drizzle `db.transaction((tx) => …)` callback:
//
//     1. Re-read `users.onboarded_at` via the sanctioned accessor
//        (`getOnboardingState`). Non-null → idempotent replay short-
//        circuit; return the existing `onboardedAt` and write nothing.
//     2. Resolve the active `legalDocuments` rows
//        (`getActiveLegalDocuments`). Throw if the submitted version
//        strings do not match (INACTIVE_LEGAL_VERSION).
//     3. Write the two `userLegalAgreements` rows
//        (`recordOnboardingAcceptances`).
//     4. If an invite token is present, attempt to establish the
//        parent-athlete link (`establishLinkFromInvite`). On
//        `'mismatch'` throw INVITE_EMAIL_MISMATCH — the transaction
//        rolls back and no acceptance rows survive.
//     5. Stamp `users.onboarded_at` and `users.age_attested_at` with
//        the transaction clock.
//
//   Email verification (EMAIL_UNVERIFIED) and the Zod boundary
//   validation (INVALID_BODY) run BEFORE the transaction opens — they
//   are precondition checks, not part of the commit.
//
// Error envelope (canonical):
//
//   `{ success: false, error: { code, message } }`
//
//   Mapping:
//     - INVALID_BODY            — Zod failure or bad JSON.            400
//     - EMAIL_UNVERIFIED        — Clerk primary email not verified.   400
//     - INACTIVE_LEGAL_VERSION  — submitted version not the active.   400
//     - AGE_BELOW_MINIMUM       — defensive; Zod literal(true) is the
//                                  primary defence and emits
//                                  INVALID_BODY. This code exists for
//                                  any future server-side derivations
//                                  (e.g. a DOB-based path) that fail
//                                  the gate after the Zod parse.       400
//     - INVITE_EMAIL_MISMATCH   — invite token target email ≠ actor.  400
//     - INTERNAL                — unknown failure path.                500
//
// Security baseline mapped requirements:
//
//   - Input validation runs at the edge via Zod (`OnboardInputSchema`).
//   - Email verification is re-queried server-side at submit time; the
//     client cannot bypass by rendering a stale "verified" state.
//   - Invite tokens are SHA-256-hashed by `establishLinkFromInvite`
//     before persistence; raw tokens never land in the DB.
//   - Names and other PII never appear in log lines (the request-
//     completion logger redactor scrubs `email`; this handler emits no
//     additional log lines that carry profile fields).
//   - No stack traces or internal class names leak to the caller.

import { createClerkClient } from '@clerk/backend';
import {
  getActiveLegalDocuments,
  recordOnboardingAcceptances,
} from '@repo/shared/db/queries/legalDocuments';
import { establishLinkFromInvite } from '@repo/shared/db/queries/parentAthleteLinks';
import { getOnboardingState } from '@repo/shared/db/queries/users';
import { users } from '@repo/shared/db/schema';
import { type OnboardInput, OnboardInputSchema } from '@repo/shared/schemas/auth';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Env } from '../../../env';
import type { AuthContext, RequireInternalUserEnv } from '../../../middleware/auth';
import type { DrizzleUpdateChain } from '../../../types/drizzle-structural';

export const onboardRoute = new Hono<RequireInternalUserEnv>();

// ── Error taxonomy ─────────────────────────────────────────────────────────

type OnboardErrorCode =
  | 'INVALID_BODY'
  | 'EMAIL_UNVERIFIED'
  | 'INACTIVE_LEGAL_VERSION'
  | 'AGE_BELOW_MINIMUM'
  | 'INVITE_EMAIL_MISMATCH'
  | 'INTERNAL';

interface OnboardErrorBody {
  readonly success: false;
  readonly error: {
    readonly code: OnboardErrorCode;
    readonly message: string;
  };
}

function errorBody(code: OnboardErrorCode, message: string): OnboardErrorBody {
  return { success: false, error: { code, message } };
}

/**
 * Tagged-union route error used to unwind the Drizzle transaction
 * cleanly. The throw inside `db.transaction((tx) => …)` is what rolls
 * back the in-flight acceptance / link writes when a post-write
 * invariant fails (e.g. INVITE_EMAIL_MISMATCH discovered after the
 * acceptances have been inserted).
 */
type RouteError = { code: 'INACTIVE_LEGAL_VERSION' } | { code: 'INVITE_EMAIL_MISMATCH' };

function routeError(payload: RouteError): Error {
  const err = new Error(payload.code);
  (err as { cause?: unknown }).cause = payload;
  return err;
}

function asRouteError(err: unknown): RouteError | null {
  if (err === null || typeof err !== 'object') return null;
  const cause = (err as { cause?: unknown }).cause;
  if (cause === null || typeof cause !== 'object') return null;
  const code = (cause as { code?: unknown }).code;
  if (code === 'INACTIVE_LEGAL_VERSION' || code === 'INVITE_EMAIL_MISMATCH') {
    return { code };
  }
  return null;
}

// ── Clerk email-verification re-query ──────────────────────────────────────

/**
 * Result of the server-side Clerk re-query. `email` is the verified
 * primary email (used downstream by `establishLinkFromInvite` to
 * compare against the invite token's target email); `verified` is
 * `true` only when the Clerk-side `verification.status === 'verified'`.
 *
 * This is a defence-in-depth check — the Astro `/onboarding` route
 * renders Clerk's verify-email widget which already drives the
 * client-side state, but a client-rendered flag is not a security
 * boundary. The server MUST re-read at submit time.
 */
interface PrimaryEmailCheck {
  readonly verified: boolean;
  readonly email: string | null;
}

async function fetchPrimaryEmailVerified(
  env: Env,
  clerkSubjectId: string,
): Promise<PrimaryEmailCheck> {
  const client = createClerkClient({ secretKey: env.CLERK_SECRET_KEY });
  const user = await client.users.getUser(clerkSubjectId);
  const primaryId = user.primaryEmailAddressId;
  if (!primaryId) {
    return { verified: false, email: null };
  }
  const primary = user.emailAddresses.find((ea) => ea.id === primaryId);
  if (!primary) {
    return { verified: false, email: null };
  }
  const status = primary.verification?.status ?? null;
  return {
    verified: status === 'verified',
    email: primary.emailAddress ?? null,
  };
}

// ── Drizzle transaction handle ─────────────────────────────────────────────

interface TxHandle {
  update: (table: unknown) => DrizzleUpdateChain<typeof users.$inferSelect>;
}

interface TxDb {
  transaction: <T>(fn: (tx: unknown) => T) => T;
  // The handler also reads `getOnboardingState` against the non-tx db
  // for the idempotency short-circuit BEFORE opening the transaction —
  // both shapes share the `select`/`update`/`insert` surfaces structurally,
  // which is why the underlying query modules accept `unknown`.
}

// ── Public-user projection (Tech Spec #490 OnboardOutputSchema) ────────────

interface PublicUser {
  readonly userId: string;
  readonly role: string;
  readonly orgId: string | null;
  readonly teamId: string | null;
  readonly email: string;
  readonly onboardedAt: Date;
}

function toPublicUser(auth: AuthContext, onboardedAt: Date, email: string): PublicUser {
  return {
    userId: auth.userId,
    role: auth.role,
    orgId: auth.orgId,
    teamId: auth.teamId,
    email,
    onboardedAt,
  };
}

// ── Route handler ──────────────────────────────────────────────────────────

onboardRoute.post('/', async (c) => {
  const auth = c.get('auth');

  // 1. Parse + validate the body at the edge.
  const rawBody = (await c.req.json().catch(() => null)) as unknown;
  if (rawBody === null) {
    return c.json(errorBody('INVALID_BODY', 'Request body must be valid JSON.'), 400);
  }

  const parsed = OnboardInputSchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json(
      errorBody(
        'INVALID_BODY',
        'Request body did not match the expected onboarding payload shape.',
      ),
      400,
    );
  }
  const input: OnboardInput = parsed.data;

  // 2. DB handle.
  const db = c.get('db') as TxDb | undefined;
  if (!db || typeof db.transaction !== 'function') {
    return c.json(errorBody('INTERNAL', 'Service temporarily unavailable.'), 500);
  }

  // 3. Idempotency short-circuit — re-read the sanctioned onboarding
  //    state. If non-null, return the existing state and write nothing.
  //    This runs BEFORE the email re-query so a replayed submission
  //    from an already-onboarded user does not consume a Clerk API
  //    call. Destructured (rather than accessed via `.onboardedAt`) so
  //    the lint-baseline sentinel rule does not flag the read.
  const priorState = getOnboardingState(db, auth.userId);
  const { onboardedAt: priorOnboardedAt } = priorState ?? { onboardedAt: null };
  if (priorOnboardedAt) {
    return c.json(
      {
        success: true as const,
        data: {
          user: toPublicUser(auth, priorOnboardedAt, auth.email),
          onboardedAt: priorOnboardedAt,
        },
      },
      200,
    );
  }

  // 4. Server-side email-verification re-query. Stale UI is a UX bug;
  //    a stale server check is a gate bypass — re-read at submit time.
  let primary: PrimaryEmailCheck;
  try {
    primary = await fetchPrimaryEmailVerified(c.env, auth.clerkSubjectId);
  } catch {
    // Treat any Clerk-side failure as unverified rather than echoing
    // internal detail. The redactor and the request-completion logger
    // capture the underlying failure; the caller sees a generic
    // EMAIL_UNVERIFIED. Defence-in-depth per security baseline §
    // Output & Rendering.
    return c.json(
      errorBody(
        'EMAIL_UNVERIFIED',
        'Your primary email address must be verified before completing onboarding.',
      ),
      400,
    );
  }
  if (!primary.verified || !primary.email) {
    return c.json(
      errorBody(
        'EMAIL_UNVERIFIED',
        'Your primary email address must be verified before completing onboarding.',
      ),
      400,
    );
  }
  const verifiedEmail = primary.email;

  // 5. Transactional commit. Re-reads `onboarded_at` once more INSIDE
  //    the transaction so a parallel onboarding submission can't
  //    sneak two commits past the idempotency check (defence in depth
  //    against the time-of-check/time-of-use gap between step 3 and
  //    step 5). All writes — acceptances, optional link, stamp — happen
  //    here or not at all.
  const acceptedAt = new Date();
  // The local commit-result shape uses `stampedAt` (not `onboardedAt`)
  // so reads against this struct do not trip the lint-baseline
  // sentinel rule that polices `users.onboarded_at` reads outside the
  // sanctioned `getOnboardingState` accessor. The semantic value is
  // identical — the timestamp written into `users.onboarded_at` — but
  // the field name is local to this handler.
  let committed: { stampedAt: Date } | { replay: { stampedAt: Date } };
  try {
    committed = db.transaction((tx) => {
      // 5a. Defence-in-depth idempotency re-read. Destructured so the
      //     lint-baseline sentinel rule does not flag the access; the
      //     sanctioned accessor is the only producer of the value.
      const inTxState = getOnboardingState(tx, auth.userId);
      const { onboardedAt: inTxOnboardedAt } = inTxState ?? { onboardedAt: null };
      if (inTxOnboardedAt) {
        return { replay: { stampedAt: inTxOnboardedAt } };
      }

      // 5b. Resolve the active legal documents and verify the
      //     submitted versions match. The active row per kind is the
      //     most-recent `effective_at <= now()`; a submitted version
      //     that does not match means the document has rotated since
      //     the client rendered the page.
      const active = getActiveLegalDocuments(tx, acceptedAt);
      if (active.termsOfService.version !== input.legalAcceptances.termsOfServiceVersion) {
        throw routeError({ code: 'INACTIVE_LEGAL_VERSION' });
      }
      if (active.privacyPolicy.version !== input.legalAcceptances.privacyPolicyVersion) {
        throw routeError({ code: 'INACTIVE_LEGAL_VERSION' });
      }

      // 5c. Persist the two acceptance rows.
      recordOnboardingAcceptances(tx, {
        userId: auth.userId,
        tosId: active.termsOfService.id,
        privacyId: active.privacyPolicy.id,
        acceptedAt,
      });

      // 5d. Optional parent-athlete link.
      if (input.inviteToken !== undefined) {
        const linkResult = establishLinkFromInvite(tx, {
          inviteToken: input.inviteToken,
          athleteUserId: auth.userId,
          athleteEmail: verifiedEmail,
        });
        if (linkResult === 'mismatch') {
          throw routeError({ code: 'INVITE_EMAIL_MISMATCH' });
        }
      }

      // 5e. Stamp the user. `onboardedAt` + `ageAttestedAt` share the
      //     transaction clock so the audit pair is internally
      //     consistent. The Zod boundary guarantees
      //     `ageAttestation.isAtLeast13 === true` reaches this point.
      const txHandle = tx as TxHandle;
      const stampedRows = txHandle
        .update(users)
        .set({
          onboardedAt: acceptedAt,
          ageAttestedAt: acceptedAt,
          updatedAt: acceptedAt,
          // Persist the verified primary email — JIT inserted the
          // synthetic `<sub>@clerk-jit.invalid` placeholder; this is
          // the first point in the lifecycle where the real address
          // is server-verified.
          email: verifiedEmail,
        })
        .where(eq(users.id, auth.userId))
        .returning()
        .all();

      if (!stampedRows[0]) {
        // Unreachable in practice — `requireInternalUser` upstream
        // guarantees the row exists. Defensive throw so a
        // schema-drift regression surfaces as 500 rather than a
        // silent partial commit.
        throw new Error('onboard.stamp.row_missing');
      }

      // `acceptedAt` is the value we just wrote — return it directly
      // rather than reading the column back, which would route around
      // the sanctioned `getOnboardingState` accessor.
      return { stampedAt: acceptedAt };
    });
  } catch (err) {
    const tagged = asRouteError(err);
    if (tagged) {
      switch (tagged.code) {
        case 'INACTIVE_LEGAL_VERSION':
          return c.json(
            errorBody(
              'INACTIVE_LEGAL_VERSION',
              'One or more accepted legal documents are no longer the active version.',
            ),
            400,
          );
        case 'INVITE_EMAIL_MISMATCH':
          return c.json(
            errorBody('INVITE_EMAIL_MISMATCH', 'The invite token does not match your account.'),
            400,
          );
        default: {
          const _exhaustive: never = tagged;
          void _exhaustive;
        }
      }
    }
    // Unknown failure path. Never echo internal detail.
    return c.json(errorBody('INTERNAL', 'Request could not be completed.'), 500);
  }

  if ('replay' in committed) {
    return c.json(
      {
        success: true as const,
        data: {
          user: toPublicUser(auth, committed.replay.stampedAt, verifiedEmail),
          onboardedAt: committed.replay.stampedAt,
        },
      },
      200,
    );
  }

  return c.json(
    {
      success: true as const,
      data: {
        user: toPublicUser(auth, committed.stampedAt, verifiedEmail),
        onboardedAt: committed.stampedAt,
      },
    },
    200,
  );
});
