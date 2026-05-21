@pending @domain-onboarding
Feature: Onboarding submit requires active legal acceptance

  AC-6 and AC-7 require that submitting onboarding without ticking
  the Terms of Service or the Privacy Policy keeps the user on the
  onboarding screen and surfaces a clear inline error. The error-
  envelope shape and the dual-write to `userLegalAgreements` live in
  Story #564's contract suite; these scenarios assert only the
  user-visible refusal.

  @ac-6
  Scenario: Submission is blocked when Terms of Service is not accepted
    Given I am signed in as "athlete"
    And I have not yet completed onboarding
    When I open the onboarding screen
    And my primary email becomes verified
    And I complete the onboarding profile fields
    And I attest that I am at least 13 years old
    And I leave the Terms of Service unaccepted
    And I accept the Privacy Policy
    And I submit the onboarding form
    Then I remain on the onboarding screen
    And I see a Terms of Service acceptance error

  @ac-7
  Scenario: Submission is blocked when Privacy Policy is not accepted
    Given I am signed in as "athlete"
    And I have not yet completed onboarding
    When I open the onboarding screen
    And my primary email becomes verified
    And I complete the onboarding profile fields
    And I attest that I am at least 13 years old
    And I accept the Terms of Service
    And I leave the Privacy Policy unaccepted
    And I submit the onboarding form
    Then I remain on the onboarding screen
    And I see a Privacy Policy acceptance error
