// apps/web/src/pages/_internal/styleguide.ts
//
// Pure-TS gate decision for the `/_internal/styleguide` page. The
// `.astro` sibling consumes `decideStyleguideAccess` so the gate
// logic is exercisable in node Vitest without an Astro renderer.
//
// The route is internal-only: only a signed-in user whose internal
// `users.role` resolves to `'dev_admin'` may see the page body. Every
// other caller (anonymous, signed-in non-dev_admin, signed-in subject
// with no internal row yet) is bounced with a 302 to `/`. The
// noindex/nofollow header is emitted unconditionally on every render
// so even the redirect response and any future bypass branch stays
// out of search indexes.
//
// Story #723 / Task #734 introduced the gate. Story #749 / Task #752
// landed the real `productionRoleLookup` body — the placeholder that
// returned `null` for every subject is replaced with a Drizzle
// SELECT against `users.clerk_subject_id`.

import { users } from '@repo/shared/db/schema';
import type { Role } from '@repo/shared/rbac';
import { eq } from 'drizzle-orm';
import { getDb } from '../../lib/db';

/**
 * Outcome of the gate decision. `redirect` short-circuits with a 302
 * to the supplied target; `allow` lets the page render.
 *
 * The two-arm shape mirrors the contract used by
 * `apps/web/src/middleware.ts` (the onboarding gate) so a future
 * production binding can fold this gate into the middleware chain
 * without re-typing its callers.
 */
export type StyleguideGateDecision =
  | { readonly kind: 'redirect'; readonly to: string; readonly status: 302 }
  | { readonly kind: 'allow' };

/**
 * Subject the gate is evaluating. `subjectId` is `null` when the
 * request is anonymous. `roleLookup` is the injectable accessor that
 * resolves the Clerk subject id to the internal user's role (or
 * `null` when no internal row exists yet — treated as a deny).
 */
export interface StyleguideGateInput {
  readonly subjectId: string | null;
  readonly roleLookup: (subjectId: string) => Role | null;
}

/**
 * Pure decision function. Allows the request only when:
 *   • the subject is signed in (non-null `subjectId`); AND
 *   • the role lookup returns `'dev_admin'`.
 *
 * Every other branch redirects to `/`. The 302 status is hard-coded
 * (rather than 303) so the redirect uses the same semantics as the
 * onboarding gate — the request is idempotent and the client may
 * cache the new location for the navigation.
 */
export function decideStyleguideAccess(input: StyleguideGateInput): StyleguideGateDecision {
  if (input.subjectId === null) {
    return { kind: 'redirect', to: '/', status: 302 };
  }
  const role = input.roleLookup(input.subjectId);
  if (role !== 'dev_admin') {
    return { kind: 'redirect', to: '/', status: 302 };
  }
  return { kind: 'allow' };
}

/**
 * Canonical noindex/nofollow response-header value. Exported as a
 * constant so the unit test pins the exact spelling and so any future
 * surface (e.g. a sitemap generator) reads from one source of truth.
 */
export const STYLEGUIDE_ROBOTS_HEADER = 'noindex, nofollow';

/**
 * Structural shape of the Drizzle select chain we exercise. Accepting
 * `unknown` at the call site and narrowing here keeps the accessor
 * portable across SQLite drivers (better-sqlite3 today, libSQL once
 * Epic #27 swaps the adapter) and mirrors the inline narrowing pattern
 * `apps/api/src/middleware/auth.ts#lookupBySubject` uses.
 */
interface SelectRoleDb {
  select: (projection: { role: typeof users.role }) => {
    from: (table: typeof users) => {
      where: (predicate: unknown) => {
        limit: (n: number) => { all: () => ReadonlyArray<{ role: string }> };
      };
    };
  };
}

/**
 * Resolve the internal user's role for a Clerk subject id.
 *
 * Mirrors the SELECT path of `requireInternalUser` in
 * `apps/api/src/middleware/auth.ts` — a single-row primary-key-equivalent
 * lookup on the UNIQUE `users.clerk_subject_id` index. Returns the role
 * verbatim from the row (so the caller can branch on `'dev_admin'` vs
 * any other role) or `null` when no row matches.
 *
 * Does NOT JIT-insert. The /_internal/styleguide gate is intentionally
 * deny-by-default for un-provisioned subjects; the JIT path lives in
 * the API middleware and runs on the first `/api/v1/*` request, not
 * here.
 *
 * The DB handle is typed structurally so the unit test passes a mock
 * chain without dragging the Drizzle driver union into the test.
 */
export function lookupRoleBySubject(db: unknown, subjectId: string): Role | null {
  const handle = db as SelectRoleDb;
  const rows = handle
    .select({ role: users.role })
    .from(users)
    .where(eq(users.clerkSubjectId, subjectId))
    .limit(1)
    .all();
  const row = rows[0];
  if (!row) return null;
  return row.role as Role;
}

/**
 * Production role lookup. Resolves the Clerk subject id to the internal
 * user's role via the lazy Drizzle handle in `apps/web/src/lib/db.ts`
 * (better-sqlite3 against `TURSO_URL` until Epic #27 swaps to libSQL).
 *
 * Returns `null` when no internal row matches — `decideStyleguideAccess`
 * treats that as a deny, preserving the PRD invariant that this
 * internal-only page never leaks to a non-dev_admin caller (PRD #742
 * AC-10).
 *
 * The function is intentionally side-effect-free at the gate level: it
 * does NOT JIT-insert. The operator's local user becomes `dev_admin`
 * via `scripts/seed-dev-admin.mjs` (Task #751), not by visiting this
 * page.
 */
export const productionRoleLookup: (subjectId: string) => Role | null = (subjectId) =>
  lookupRoleBySubject(getDb(), subjectId);
