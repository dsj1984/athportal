@pending @issue-997 @domain-onboarding
Feature: Replaying onboarding submission is a no-op for an onboarded user

  AC-14 requires the onboarding submission to be idempotent for a user
  whose completion timestamp is already stamped: a replay keeps them
  on the dashboard and never overwrites the previously-recorded
  completion. The DB-side invariant (the existing `onboarded_at`
  timestamp is unchanged, no duplicate `userLegalAgreements` rows are
  written) lives in Story #564's contract suite — this scenario names
  the user-visible outcome only.

  @ac-14
  Scenario: Replaying onboarding submission for an onboarded user is a no-op
    Given I am signed in as "athlete"
    And I have already completed onboarding
    When I navigate directly to the onboarding surface
    And I submit the onboarding form
    Then I see the dashboard surface
    And my previously-recorded onboarding completion is unchanged
