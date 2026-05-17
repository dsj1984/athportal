/**
 * RBAC (role-based access control) step library.
 *
 * Reserved for downstream Epics. Will own Then phrases asserting
 * role-gated visibility and access-denied outcomes once the three-tier
 * role model (`dev_admin` / `org_admin` / `team_admin`) lands. Policy-
 * level RBAC assertions live at the unit tier in
 * `packages/shared/src/rbac/`; enforcement assertions live at the contract
 * tier. This file owns only user-visible RBAC outcomes — see the
 * assertion-placement rule in `.agents/rules/testing-standards.md`.
 */
export {};
