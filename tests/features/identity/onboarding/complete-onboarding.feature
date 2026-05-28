@pending @issue-997 @domain-onboarding
Feature: A user can complete onboarding and reach the dashboard

  AC-5 names the load-bearing happy path of Epic #8: a user who fills
  in their profile, verifies their email through Clerk, attests they
  are at least 13, and actively accepts both the Terms of Service and
  the Privacy Policy submits the onboarding form once and lands on the
  dashboard. Wire-shape of the submit (status code, request envelope,
  the dual write to `userLegalAgreements`) lives in Story #564's
  contract tier; this scenario asserts only the user-visible journey.

  @ac-5
  Scenario: Athlete completes onboarding and lands on the dashboard
    Given I am signed in as "athlete"
    And I have not yet completed onboarding
    When I open the onboarding screen
    And my primary email becomes verified
    And I complete the onboarding profile fields
    And I attest that I am at least 13 years old
    And I accept the Terms of Service
    And I accept the Privacy Policy
    And I submit the onboarding form
    Then I see the dashboard surface
