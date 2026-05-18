/**
 * RBAC rules table for `story-c-rbac-policy` (Story #327, Epic #7).
 *
 * One row per `(role, resource, action)` triple. There are NO implicit
 * fallthroughs: every triple in `Role × Resource × Action` (80 entries)
 * appears in `RULES` with an explicit allow/deny. The `canPerform()`
 * policy function (see `./policy.ts`) looks up the row and returns
 * `false` for an unknown triple as a deny-by-default safeguard.
 *
 * Design notes (Tech Spec #318 §D, §E):
 * - Scope/owner guards are factored as **named predicates** so the
 *   table reads as a registry of business rules, not a stack of
 *   inline `actorOrgId === resourceOrgId` snippets. The same
 *   predicate is reused across many rules.
 * - The last-admin guard (`lastAdminGuard`) is its own predicate.
 *   Story D (last-admin enforcement) will wire the same predicate
 *   into the `org_admin` / `user` / `update` and `delete` slots —
 *   the slot exists today; the data populating it is the caller's
 *   responsibility (it must read `remainingAdminsAfter` inside the
 *   same transaction as the mutation).
 * - Predicates take a single `RbacContext`. They are pure — no I/O,
 *   no `Date.now()`, no caller closures.
 */

import type { Action, Resource, Role, RbacContext } from './types';

/**
 * Predicate over an `RbacContext`. Returns `true` when the rule
 * should allow the action, `false` to deny.
 *
 * Exported so consumers (and tests) can reference the named guards
 * directly when composing higher-level checks.
 */
export type RbacPredicate = (ctx: RbacContext) => boolean;

/**
 * Unconditional allow / deny — used for the many triples where the
 * decision is role-and-resource-shaped without context.
 *
 * `dev_admin`, for example, is allow-all by definition; `member`
 * is deny-by-default for every admin-shaped action.
 */
export const allow: RbacPredicate = () => true;
export const deny: RbacPredicate = () => false;

/**
 * Actor's org matches the resource's org.
 *
 * Both sides MUST be present and non-empty; a missing
 * `actorOrgId` or `resourceOrgId` is treated as a non-match
 * (deny). This is the most common scope guard in the table —
 * `org_admin` rules consult it for every cross-org check.
 */
export const sameOrg: RbacPredicate = (ctx) =>
  Boolean(ctx.actorOrgId) &&
  Boolean(ctx.resourceOrgId) &&
  ctx.actorOrgId === ctx.resourceOrgId;

/**
 * Actor's team matches the resource's team, AND the orgs match.
 *
 * `team_admin` rules consult this guard so a team admin in org A
 * cannot reach into a same-named team in org B. The compound
 * check is deliberate — never rely on team-id uniqueness across
 * orgs at the data layer; enforce it here.
 */
export const sameTeam: RbacPredicate = (ctx) =>
  sameOrg(ctx) &&
  Boolean(ctx.actorTeamId) &&
  Boolean(ctx.resourceTeamId) &&
  ctx.actorTeamId === ctx.resourceTeamId;

/**
 * Actor owns the resource (`actorId === resourceOwnerId`).
 *
 * Used for the `member` / `user` / self-update rule and friends.
 * Both sides MUST be present and non-empty.
 */
export const isOwner: RbacPredicate = (ctx) =>
  Boolean(ctx.actorId) &&
  Boolean(ctx.resourceOwnerId) &&
  ctx.actorId === ctx.resourceOwnerId;

/**
 * Last-admin guard. Refuses the mutation when applying it would
 * leave the org with zero admin-role users.
 *
 * The caller (route handler) is responsible for populating
 * `remainingAdminsAfter` inside the same transaction as the
 * mutation. When the field is `undefined` we conservatively
 * deny — refusing to act on an unsupplied count is safer than
 * defaulting to allow.
 */
export const lastAdminGuard: RbacPredicate = (ctx) =>
  typeof ctx.remainingAdminsAfter === 'number' &&
  ctx.remainingAdminsAfter > 0;

/**
 * `org_admin` updating or deleting a `user` row: both the org-scope
 * AND the last-admin guard must hold.
 */
export const sameOrgWithLastAdmin: RbacPredicate = (ctx) =>
  sameOrg(ctx) && lastAdminGuard(ctx);

/**
 * Lookup key for the rules table — a `(role, resource, action)` triple.
 */
export interface RuleKey {
  role: Role;
  resource: Resource;
  action: Action;
}

/**
 * A single row in the rules table.
 *
 * `predicate` is the guard the policy invokes. The optional `note`
 * field is for human readers — it never affects the decision.
 */
export interface Rule extends RuleKey {
  predicate: RbacPredicate;
  note?: string;
}

/**
 * Compact constructor that keeps the table easy to scan vertically.
 */
function rule(
  role: Role,
  resource: Resource,
  action: Action,
  predicate: RbacPredicate,
  note?: string,
): Rule {
  return { role, resource, action, predicate, note };
}

/**
 * The closed enumeration of every triple this Epic ships.
 *
 * Adding a new `Role`, `Resource`, or `Action` in `./types.ts` MUST
 * be accompanied by an extension of this array — the unit test
 * `policy.test.ts` walks the cartesian product and asserts every
 * triple is represented exactly once.
 */
export const RULES: ReadonlyArray<Rule> = [
  // ─── dev_admin ────────────────────────────────────────────────
  // The platform-level root role. Allow-all by design (Tech Spec
  // §D table footnote). Power matched by audit logging at the
  // route layer — that's a different invariant from this one.
  rule('dev_admin', 'organization', 'create', allow),
  rule('dev_admin', 'organization', 'read', allow),
  rule('dev_admin', 'organization', 'update', allow),
  rule('dev_admin', 'organization', 'delete', allow),
  rule('dev_admin', 'organization', 'list', allow),
  rule('dev_admin', 'team', 'create', allow),
  rule('dev_admin', 'team', 'read', allow),
  rule('dev_admin', 'team', 'update', allow),
  rule('dev_admin', 'team', 'delete', allow),
  rule('dev_admin', 'team', 'list', allow),
  rule('dev_admin', 'user', 'create', allow),
  rule('dev_admin', 'user', 'read', allow),
  rule('dev_admin', 'user', 'update', allow),
  rule('dev_admin', 'user', 'delete', allow),
  rule('dev_admin', 'user', 'list', allow),
  rule('dev_admin', 'invitation', 'create', allow),
  rule('dev_admin', 'invitation', 'read', allow),
  rule('dev_admin', 'invitation', 'update', allow),
  rule('dev_admin', 'invitation', 'delete', allow),
  rule('dev_admin', 'invitation', 'list', allow),

  // ─── org_admin ────────────────────────────────────────────────
  // Manages everything inside their own org. Cannot create or
  // delete the org itself (that's a `dev_admin` operation);
  // CAN update settings on the org row they own.
  rule(
    'org_admin',
    'organization',
    'create',
    deny,
    'orgs are provisioned by dev_admin only',
  ),
  rule('org_admin', 'organization', 'read', sameOrg),
  rule('org_admin', 'organization', 'update', sameOrg),
  rule(
    'org_admin',
    'organization',
    'delete',
    deny,
    'orgs are decommissioned by dev_admin only',
  ),
  rule(
    'org_admin',
    'organization',
    'list',
    allow,
    'list returns the actor’s own org only; scope filter applied in the query layer',
  ),
  rule('org_admin', 'team', 'create', sameOrg),
  rule('org_admin', 'team', 'read', sameOrg),
  rule('org_admin', 'team', 'update', sameOrg),
  rule('org_admin', 'team', 'delete', sameOrg),
  rule('org_admin', 'team', 'list', sameOrg),
  rule('org_admin', 'user', 'create', sameOrg),
  rule('org_admin', 'user', 'read', sameOrg),
  rule(
    'org_admin',
    'user',
    'update',
    sameOrgWithLastAdmin,
    'role demotion that drops the last admin is refused; caller populates remainingAdminsAfter',
  ),
  rule(
    'org_admin',
    'user',
    'delete',
    sameOrgWithLastAdmin,
    'removal that drops the last admin is refused; caller populates remainingAdminsAfter',
  ),
  rule('org_admin', 'user', 'list', sameOrg),
  rule('org_admin', 'invitation', 'create', sameOrg),
  rule('org_admin', 'invitation', 'read', sameOrg),
  rule('org_admin', 'invitation', 'update', sameOrg),
  rule('org_admin', 'invitation', 'delete', sameOrg),
  rule('org_admin', 'invitation', 'list', sameOrg),

  // ─── team_admin ───────────────────────────────────────────────
  // Manages roster-shaped resources inside their own team. CANNOT
  // touch the parent org or sibling teams; CANNOT update users'
  // org-level role (`update` on `user` is denied — that's an
  // `org_admin` operation).
  rule('team_admin', 'organization', 'create', deny),
  rule(
    'team_admin',
    'organization',
    'read',
    sameOrg,
    'team admins can read the org they belong to (name, branding) but not mutate it',
  ),
  rule('team_admin', 'organization', 'update', deny),
  rule('team_admin', 'organization', 'delete', deny),
  rule('team_admin', 'organization', 'list', deny),
  rule('team_admin', 'team', 'create', deny, 'teams are provisioned by org_admin'),
  rule('team_admin', 'team', 'read', sameTeam),
  rule('team_admin', 'team', 'update', sameTeam),
  rule(
    'team_admin',
    'team',
    'delete',
    deny,
    'teams are decommissioned by org_admin',
  ),
  rule(
    'team_admin',
    'team',
    'list',
    sameOrg,
    'team admins see all teams in their org; per-team mutations still gated by sameTeam',
  ),
  rule(
    'team_admin',
    'user',
    'create',
    deny,
    'user provisioning is owned by org_admin; team rosters are managed via invitations',
  ),
  rule('team_admin', 'user', 'read', sameTeam),
  rule(
    'team_admin',
    'user',
    'update',
    deny,
    'team admins cannot mutate user.role or user.org_id; invitation flows cover roster changes',
  ),
  rule('team_admin', 'user', 'delete', deny),
  rule('team_admin', 'user', 'list', sameTeam),
  rule('team_admin', 'invitation', 'create', sameTeam),
  rule('team_admin', 'invitation', 'read', sameTeam),
  rule('team_admin', 'invitation', 'update', sameTeam),
  rule('team_admin', 'invitation', 'delete', sameTeam),
  rule('team_admin', 'invitation', 'list', sameTeam),

  // ─── member ───────────────────────────────────────────────────
  // The no-admin baseline — `athlete` personas. Read-only on the
  // resources they belong to, plus self-update on their own user
  // row. All other actions deny by design.
  rule('member', 'organization', 'create', deny),
  rule(
    'member',
    'organization',
    'read',
    sameOrg,
    'members see their own org (name, branding)',
  ),
  rule('member', 'organization', 'update', deny),
  rule('member', 'organization', 'delete', deny),
  rule('member', 'organization', 'list', deny),
  rule('member', 'team', 'create', deny),
  rule('member', 'team', 'read', sameTeam),
  rule('member', 'team', 'update', deny),
  rule('member', 'team', 'delete', deny),
  rule('member', 'team', 'list', deny),
  rule('member', 'user', 'create', deny),
  rule(
    'member',
    'user',
    'read',
    sameTeam,
    'members can read teammates on their own team',
  ),
  rule(
    'member',
    'user',
    'update',
    isOwner,
    'self-only update — members edit their own profile, never anyone else’s',
  ),
  rule('member', 'user', 'delete', deny, 'account deletion is an admin operation'),
  rule('member', 'user', 'list', deny),
  rule('member', 'invitation', 'create', deny),
  rule(
    'member',
    'invitation',
    'read',
    isOwner,
    'recipients read their own invitation by token; ownership pinned to resourceOwnerId',
  ),
  rule('member', 'invitation', 'update', deny),
  rule('member', 'invitation', 'delete', deny),
  rule('member', 'invitation', 'list', deny),
] as const;

/**
 * Internal: map for O(1) lookups. Keyed by the canonical
 * `role|resource|action` string so the policy never iterates the
 * array at request time.
 */
const RULE_INDEX: ReadonlyMap<string, Rule> = (() => {
  const map = new Map<string, Rule>();
  for (const r of RULES) {
    const key = `${r.role}|${r.resource}|${r.action}`;
    if (map.has(key)) {
      // Authoring error: two rows for the same triple. Surface
      // loudly at module load so a bad merge is caught in the
      // first test run rather than producing silent precedence.
      throw new Error(`rbac/rules: duplicate rule for ${key}`);
    }
    map.set(key, r);
  }
  return map;
})();

/**
 * Look up a rule by triple. Returns `undefined` for unknown
 * triples — the policy layer handles deny-by-default.
 */
export function findRule(key: RuleKey): Rule | undefined {
  return RULE_INDEX.get(`${key.role}|${key.resource}|${key.action}`);
}
