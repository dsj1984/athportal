@epic-9 @domain-graph
Feature: Hard-deleted athlete leaves a verified-stats tombstone

  Epic #9 (AC-92, originally Acceptance Spec AC-10) pins the
  athlete hard-delete cascade: removing an athlete cascades to roster
  rows in `coach_assignments` / `athlete_memberships` but does not
  remove the athlete's historical verified stats — those tombstone per
  the MVP data-rights posture (Epic #24). Full cryptographic
  tombstoning is deferred to v1.0 with the Verified Placement Record
  Epic (#29). Wire shape (the cascade DELETE, the tombstone row
  shape, the rollback on FK enforcement failure) lives in the contract
  suite once #24's deletion handlers land; AC-92 here is the
  user-visible end of that pipeline.

  @ac-92 @persona-org-admin
  Scenario: Hard-deleted athlete is removed from rosters but their verified stats remain visible
    Given I am signed in as "org admin"
    And an athlete in my organization has hard-deleted their account
    When I open the roster page for the team they used to be on
    Then I see that the athlete no longer appears on the roster
    And the historical verified stats they earned still appear in the team's stats archive
