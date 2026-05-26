/**
 * @repo/shared/db/queries/users — sanctioned reader of `users.onboarded_at`.
 *
 * This module is the **only** code path in the repository permitted to read
 * `users.onboarded_at` (or `users.ageAttestedAt`) directly. Every other
 * consumer — the Astro middleware, the Hono `requireOnboarded` guard, the
 * onboarding handler's idempotency re-read, contract and unit tests that
 * verify the gate — MUST route through `getOnboardingState`.
 *
 * The constraint is enforced by the lint-baseline ratchet (Story #555,
 * Task #570): any `.onboardedAt` token outside this file (or outside test
 * files matched by `*.test.*`) trips the gate. Adding a new reader means
 * adding a new exported function here — never a one-off direct query.
 *
 * The DB handle is typed structurally (`SelectOnboardingDb`) so this
 * module can be consumed by both Worker (`@libsql/client`) and
 * better-sqlite3 (contract test) flavours without coupling to either
 * Drizzle driver union. The pattern mirrors `apps/api/src/types/
 * drizzle-structural.ts`.
 *
 * Introduced by Epic #8 / Story #555 / Task #566. Tech Spec #490.
 */

import { eq } from 'drizzle-orm';
import { users } from '../schema/users';

export interface OnboardingState {
  readonly onboardedAt: Date | null;
  readonly ageAttestedAt: Date | null;
}

interface OnboardingRow {
  readonly onboardedAt: Date | null;
  readonly ageAttestedAt: Date | null;
}

/**
 * Structural shape of the Drizzle select chain we exercise. Accepting
 * `unknown` at the call site and narrowing here keeps the accessor
 * portable across SQLite drivers.
 */
interface SelectOnboardingDb {
  select: (projection: {
    onboardedAt: typeof users.onboardedAt;
    ageAttestedAt: typeof users.ageAttestedAt;
  }) => {
    from: (table: typeof users) => {
      where: (predicate: unknown) => {
        limit: (n: number) => { all: () => Array<OnboardingRow> };
      };
    };
  };
}

/**
 * Read the onboarding state for `userId`.
 *
 * Returns `null` when no row exists with that id — callers that need to
 * distinguish "missing user" from "present but not onboarded" rely on the
 * `null` return rather than catching an exception. A present user who
 * has not yet onboarded returns `{ onboardedAt: null, ageAttestedAt: null }`.
 *
 * The query is a single-row primary-key lookup; it is cheap to call from
 * every gated request handler.
 */
export function getOnboardingState(db: unknown, userId: string): OnboardingState | null {
  const handle = db as SelectOnboardingDb;
  const rows = handle
    .select({
      onboardedAt: users.onboardedAt,
      ageAttestedAt: users.ageAttestedAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
    .all();
  const row = rows[0];
  if (!row) return null;
  return {
    onboardedAt: row.onboardedAt ?? null,
    ageAttestedAt: row.ageAttestedAt ?? null,
  };
}

/**
 * Read the onboarding state for the user matching `clerkSubjectId`.
 *
 * Sibling of `getOnboardingState` (which queries `users.id`). The web
 * runtime's Astro middleware only sees the Clerk `sub` claim — not the
 * internal `users.id` — because no JIT-provisioner runs on the web side
 * (the API edge owns JIT). The middleware therefore needs a read that
 * keys on `clerk_subject_id`.
 *
 * Returns `null` when no row exists with that subject — the gate treats
 * `null` as un-onboarded and 302s to `/onboarding`, which is the safe
 * default for a signed-in subject without an internal row (the JIT path
 * hasn't run yet, or the row was deleted out-of-band).
 *
 * The lint-baseline sentinel that pins `users.onboarded_at` reads to
 * this module applies here too — keep this accessor in lockstep with
 * `getOnboardingState` and never inline the `clerk_subject_id` lookup
 * at a call site.
 *
 * Introduced by Epic #869 (web DB binding cutover hotfix). Story #878
 * shipped `productionLookup` against the existing `getOnboardingState`,
 * but that accessor keys on `users.id`; passing a Clerk subject was a
 * silent miss that 302'd every signed-in user back to `/onboarding`.
 */
export function getOnboardingStateBySubject(
  db: unknown,
  clerkSubjectId: string,
): OnboardingState | null {
  const handle = db as SelectOnboardingDb;
  const rows = handle
    .select({
      onboardedAt: users.onboardedAt,
      ageAttestedAt: users.ageAttestedAt,
    })
    .from(users)
    .where(eq(users.clerkSubjectId, clerkSubjectId))
    .limit(1)
    .all();
  const row = rows[0];
  if (!row) return null;
  return {
    onboardedAt: row.onboardedAt ?? null,
    ageAttestedAt: row.ageAttestedAt ?? null,
  };
}

/**
 * Sanctioned predicate: does `state` represent a fully-onboarded user?
 *
 * Returns `false` for both `null` (no user row) and a state whose
 * `onboardedAt` is null (present but not yet onboarded). Callers gating
 * a protected resource should use this helper rather than reading
 * `state.onboardedAt` directly — the lint-baseline ratchet forbids any
 * `.onboardedAt` read outside this module, and this predicate is the
 * read-side counterpart to `getOnboardingState`.
 */
export function isOnboarded(state: OnboardingState | null): boolean {
  return state !== null && state.onboardedAt !== null;
}
