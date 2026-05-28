@pending @issue-997 @domain-auth
Feature: Last-admin guard refuses to leave an org orphaned

  Removing the last remaining org admin would orphan the organization —
  every subsequent admin-only action would fail and no one could repair
  the membership without operator intervention. AC-7 asserts that the
  org admin who attempts the removal sees a clear refusal banner and the
  remaining admin stays in place. Wire shape (the 409 LAST_ADMIN
  envelope, the rollback, the transactional admin count) lives in the
  contract suite.

  @smoke @ac-7 @persona-org-admin
  Scenario: Org admin cannot remove the last org admin
    Given I am signed in as "org admin"
    And I am the only remaining org admin in my organization
    When I attempt to remove myself from the org admin role
    Then I see the last-admin refusal banner
    And I remain an org admin in my organization
