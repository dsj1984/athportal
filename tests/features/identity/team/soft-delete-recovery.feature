@epic-9 @domain-graph
Feature: Soft-deleted team can be recovered within 30 days

  Epic #9 (AC-91, originally Acceptance Spec AC-9) pins the team
  soft-delete contract: setting `teams.deleted_at` ends athlete
  memberships and coach assignments immediately but preserves athlete
  profiles and historical verified stats. The team row remains
  queryable for a 30-day recovery window before a separate cleanup job
  hard-deletes it. Wire shape (the `deleted_at` column state, the
  cascade rules, the membership end-dating) lives in the contract
  suite at
  `packages/shared/src/db/schema/__tests__/teamSoftDelete.contract.test.ts`.

  @ac-91 @persona-org-admin
  Scenario: Org admin recovers a soft-deleted team within the 30-day window
    Given I am signed in as "org admin"
    And one of my teams was soft-deleted in the last 30 days
    When I open the recently deleted teams view and restore that team
    Then I see the team return to my active roster
    And every athlete who was on the team retains their profile and verified stats history
