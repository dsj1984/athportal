@pending @domain-onboarding
Feature: Onboarding submit is gated by Clerk email verification

  AC-3 and AC-4 require that the onboarding submit control stays
  disabled until Clerk reports the user's primary email as verified,
  and that the user can trigger a verification-email resend from the
  onboarding screen. Clerk owns the verification round-trip (Tech
  Spec #490 §Email verification); these scenarios assert only the
  user-visible state on the gate.

  @ac-3
  Scenario: Submit is blocked until primary email is verified
    Given I am signed in as "athlete"
    And I have not yet completed onboarding
    When I open the onboarding screen
    And I complete the onboarding profile fields
    And I attest that I am at least 13 years old
    And I accept the Terms of Service
    And I accept the Privacy Policy
    And my primary email is not yet verified
    Then the submit control is disabled

  @ac-4
  Scenario: Resending the verification email and seeing the verified state reflected
    Given I am signed in as "athlete"
    And I have not yet completed onboarding
    When I open the onboarding screen
    And I request a verification email
    And my primary email becomes verified
    Then the submit control becomes enabled
