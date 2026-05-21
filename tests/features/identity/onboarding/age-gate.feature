@pending @domain-onboarding
Feature: Under-13 attestation blocks onboarding

  AC-8 requires that a user who attests to being under 13 sees a
  clear "not available" message and is not granted access to the
  product. The age-gate is re-validated at the API edge via
  `z.literal(true)` (Tech Spec #490); this scenario asserts only the
  user-visible refusal.

  @ac-8
  Scenario: Under-13 attestation blocks onboarding with a clear message
    Given I am signed in as "athlete"
    And I have not yet completed onboarding
    When I open the onboarding screen
    And my primary email becomes verified
    And I complete the onboarding profile fields
    And I attest that I am under 13
    And I accept the Terms of Service
    And I accept the Privacy Policy
    And I submit the onboarding form
    Then I see an under-13 not-available message
    And I remain on the onboarding screen
