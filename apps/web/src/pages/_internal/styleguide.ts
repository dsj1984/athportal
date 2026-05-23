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
// Story #723 / Task #734. Tech Spec #704. PRD #703.

import type { Role } from '@repo/shared/rbac';

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
 * Production role lookup. The web runtime does not yet carry a DB
 * handle — Tech Spec #704 §Architecture lands the production binding
 * alongside the matching cutover in a later Wave. Until that binding
 * exists this placeholder returns `null` for every subject, which the
 * gate treats as the safe default "not dev_admin → 302 to /". This
 * preserves the PRD invariant that an internal-only page never leaks
 * to a non-dev_admin caller, even before the DB binding lands.
 *
 * Tests inject a deterministic stub instead.
 */
export const productionRoleLookup: (subjectId: string) => Role | null = () => null;
