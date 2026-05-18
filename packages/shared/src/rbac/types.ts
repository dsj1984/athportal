/**
 * RBAC type vocabulary for `story-c-rbac-policy` (Story #327, Epic #7).
 *
 * Single typed surface shared by the pure `canPerform()` policy
 * function (`./policy.ts`), the data-driven rules table (`./rules.ts`),
 * and every downstream consumer (Hono middleware, route handlers,
 * Playwright fixtures, contract tests).
 *
 * Design notes (Tech Spec #318 §D):
 * - `member` is the no-admin baseline role used by the `athlete`
 *   persona. It exists so the rules table covers signed-in users who
 *   have no admin privileges with an *explicit* deny rather than a
 *   fallthrough.
 * - `RbacContext` is the *whole* state the policy consults. It is
 *   populated by the caller (route handler or service layer) before
 *   `canPerform()` is invoked; the policy itself is pure and performs
 *   no I/O.
 * - `AuthContext` mirrors the shape `requireInternalUser` attaches to
 *   `c.var.auth` after JIT user provisioning. Adding fields here
 *   means updating the JIT path in lockstep.
 */

/**
 * The four roles enumerated in Epic #7's PRD (#317).
 *
 * Order is deliberately privilege-descending so reviewers can spot
 * accidental upgrades in role tables: `dev_admin` > `org_admin` >
 * `team_admin` > `member`. Privilege is not derived from this
 * ordering — every rule is explicit — but the convention helps
 * humans read the rules table.
 */
export type Role = 'dev_admin' | 'org_admin' | 'team_admin' | 'member';

/**
 * Resources the policy currently understands.
 *
 * The Tech Spec marks this set as "extensible per Epic": later Epics
 * that introduce new resources (e.g. `event`, `invoice`) MUST extend
 * this union and add the corresponding rows to `rules.ts` — never
 * widen at the call site with `as Resource` casts.
 */
export type Resource = 'organization' | 'team' | 'user' | 'invitation';

/**
 * Verbs the policy decides over.
 *
 * The five verbs match the CRUD-plus-list shape of the v1 API surface
 * (`docs/architecture.md` §2). `list` is modelled distinctly from
 * `read` because list endpoints typically need scope-only checks
 * (return rows the actor can see) whereas `read` is per-resource.
 */
export type Action = 'create' | 'read' | 'update' | 'delete' | 'list';

/**
 * Context the policy consults when evaluating a `(role, resource,
 * action)` triple.
 *
 * Every field is optional because not every triple needs every
 * field; the rules table is responsible for asserting the fields
 * it relies on. A missing field for a rule that needs it MUST
 * cause the rule to deny.
 *
 * - `actorOrgId` / `actorTeamId`: scope of the calling user.
 * - `resourceOrgId` / `resourceTeamId`: scope of the resource the
 *   action targets. Used by org-scope and team-scope predicates.
 * - `resourceOwnerId`: owner of the resource. Used for self-only
 *   rules (e.g. a `member` can update their own user row).
 * - `actorId`: id of the calling user (paired with
 *   `resourceOwnerId` for ownership checks).
 * - `remainingAdminsAfter`: count of admin-role users that would
 *   remain in the org *after* the mutation succeeds. Populated by
 *   the route handler inside the same transaction as the update;
 *   the last-admin guard reads it to refuse the mutation when the
 *   count would drop to 0.
 */
export interface RbacContext {
  actorId?: string;
  actorOrgId?: string;
  actorTeamId?: string;
  resourceOrgId?: string;
  resourceTeamId?: string;
  resourceOwnerId?: string;
  remainingAdminsAfter?: number;
}

/**
 * The auth context the production middleware attaches to every
 * authenticated request.
 *
 * Mirrors the shape returned by `requireInternalUser` (Tech Spec
 * #318 §C). Test fixtures use the same type so contract tests
 * exercise the same code paths as production.
 *
 * - `userId`: internal `users.id` (cuid2) — the stable handle.
 * - `clerkSubjectId`: opaque Clerk subject. Not PII, but treat as
 *   sensitive: do not log alongside email.
 * - `role`: the `users.role` column, narrowed to the `Role` union.
 * - `orgId` / `teamId`: scope. `dev_admin` always has both null;
 *   `org_admin` has `orgId` set; `team_admin` has both set.
 */
export interface AuthContext {
  userId: string;
  clerkSubjectId: string;
  role: Role;
  orgId?: string;
  teamId?: string;
}
