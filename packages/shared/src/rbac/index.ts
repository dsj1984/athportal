/**
 * Barrel for the RBAC policy module (Story #327, Epic #7).
 *
 * Downstream consumers (`apps/api` middleware, route handlers,
 * Playwright fixtures, contract test helpers) MUST import from
 * `@repo/shared/rbac` rather than reaching into individual files.
 * That keeps the public surface stable as the rules table and
 * predicates evolve.
 */

export { canPerform } from './policy';

export type {
  Action,
  AuthContext,
  RbacContext,
  Resource,
  Role,
} from './types';

export {
  allow,
  deny,
  findRule,
  isOwner,
  lastAdminGuard,
  RULES,
  sameOrg,
  sameOrgWithLastAdmin,
  sameTeam,
} from './rules';

export type { Rule, RuleKey, RbacPredicate } from './rules';
