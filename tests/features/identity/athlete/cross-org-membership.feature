@epic-9 @domain-graph
Feature: Cross-org athlete membership is refused

  Epic #9 (AC-90, originally Acceptance Spec AC-8) pins the
  cross-tenant membership invariant: an athlete may belong to many
  teams within their own organization but cannot be added to a team in
  a different organization. The persistence-layer guards
  (`coach_assignments` / `athlete_memberships` CHECK triggers and the
  `scopedDb(actor)` proxy) refuse the wiring at insert time. This
  scenario captures the user-visible side of that refusal — when the
  underlying admin UI lands in Epic #10 / #11 it should render the
  same refusal banner the operator sees here. Wire shape (the 404
  envelope, the rollback, the rejected row) lives in the contract
  suite at `packages/shared/src/db/schema/__tests__/athleteMembershipsCrossOrg.contract.test.ts`.

  @ac-90 @persona-org-admin
  Scenario: Org admin cannot add an athlete from another organization to their team
    Given I am signed in as "org admin"
    And an athlete exists in a different organization
    When I attempt to add that athlete to one of my teams
    Then I see the cross-org refusal banner
    And the athlete remains a member of their original organization only
