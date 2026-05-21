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
