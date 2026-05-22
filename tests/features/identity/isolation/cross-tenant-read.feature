@epic-9 @domain-graph
Feature: Cross-tenant reads return not-found

  Epic #9 (AC-93, originally Acceptance Spec AC-11) pins the
  load-bearing read-side invariant: every request against the
  org/team/coach/athlete graph filters by the requesting actor's
  organization. A request for a resource that lives in a different
  organization returns the same outcome a request for a missing
  resource would — the existence of the cross-tenant row is never
  observable. The persistence-layer defense is the
  `scopedDb(actor)` proxy at
  `packages/shared/src/db/queries/scopedDb.ts`; the wire-shape contract
  (404 with `NOT_FOUND` envelope, no row mutation, no membership leak)
  is pinned by
  `apps/api/src/routes/v1/users/role.contract.test.ts:258-318` and
  `packages/shared/src/db/queries/__tests__/scopedDbCrossTenant.contract.test.ts`.

  @ac-93 @persona-org-admin
  Scenario: Org admin requesting a user from a different organization sees a not-found page
    Given I am signed in as "org admin"
    And a user exists in a different organization
    When I navigate to that user's profile page
    Then I see a not-found page
    And the cross-org user's profile row remains unchanged
