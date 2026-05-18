/**
 * `canPerform()` — the single decision point for `story-c-rbac-policy`
 * (Story #327, Epic #7).
 *
 * Pure by design (Tech Spec #318 §D):
 *   - no I/O, no DB, no `fetch`, no `Date.now()`, no module-scope
 *     state mutation;
 *   - inputs are typed; outputs are `boolean`;
 *   - unknown `(role, resource, action)` triples return `false`
 *     (deny-by-default safeguard backing the exhaustive rules
 *     table — see `./rules.ts`).
 *
 * Consumers (Hono middleware, route handlers, Playwright fixtures)
 * MUST always go through this function. Re-implementing the lookup
 * locally is forbidden because it defeats the audit guarantee — the
 * unit suite (`./policy.test.ts`) walks the cartesian product and
 * asserts every triple's allow/deny shape; that guarantee only holds
 * for callers that come through `canPerform()`.
 */

import { findRule } from './rules';
import type { Action, RbacContext, Resource, Role } from './types';

/**
 * Decide whether `role` is allowed to perform `action` on `resource`
 * given the supplied `ctx`.
 *
 * @param role — the calling actor's role (from `AuthContext.role`).
 * @param resource — the resource the action targets.
 * @param action — the verb.
 * @param ctx — populated by the caller. For scope-shaped rules the
 *              caller MUST supply the matching scope fields; for
 *              the last-admin-guarded rules the caller MUST supply
 *              `remainingAdminsAfter` inside the same transaction
 *              as the mutation. Missing fields cause the matching
 *              predicate to deny — never silently allow.
 * @returns `true` when the rule's predicate is satisfied;
 *          `false` for an explicit deny or an unknown triple.
 */
export function canPerform(
  role: Role,
  resource: Resource,
  action: Action,
  ctx: RbacContext,
): boolean {
  const rule = findRule({ role, resource, action });
  if (!rule) {
    // Deny-by-default. The rules table is exhaustive at the type
    // level (the unit test enforces it), so this branch is
    // unreachable for in-union inputs and exists purely as a
    // safety net for runtime callers that bypassed TypeScript
    // (e.g. JS interop, deserialized payloads).
    return false;
  }
  return rule.predicate(ctx);
}
