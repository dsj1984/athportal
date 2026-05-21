@pending @domain-onboarding
Feature: Parent-athlete link is established at onboarding close

  AC-11 and AC-12 require that an invite accepted during onboarding
  links the parent to the athlete only when the invite was addressed
  to the same email as the accepting account. A mismatched invite
  email is rejected with an explanatory error and no link record is
  written. The link-row shape and the email-match check live at the
  contract tier; these scenarios assert the user-visible outcome on
  the post-onboarding dashboard.

  @ac-11
  Scenario: Parent-athlete link is established when invite email matches the account
    Given I am signed in as "athlete"
    And I have not yet completed onboarding
    And I have a pending invite addressed to my account email
    When I open the onboarding screen
    And my primary email becomes verified
    And I complete the onboarding profile fields
    And I attest that I am at least 13 years old
    And I accept the Terms of Service
    And I accept the Privacy Policy
    And I accept the invite during onboarding
    And I submit the onboarding form
    Then I see the dashboard surface
    And I see the linked athlete on my dashboard

  @ac-12
  Scenario: Invite email mismatch blocks linking with an explanatory error
    Given I am signed in as "athlete"
    And I have not yet completed onboarding
    And I have a pending invite addressed to a different email than my account
    When I open the onboarding screen
    And my primary email becomes verified
    And I complete the onboarding profile fields
    And I attest that I am at least 13 years old
    And I accept the Terms of Service
    And I accept the Privacy Policy
    And I accept the invite during onboarding
    Then I see an invite-mismatch error
    And I remain on the onboarding screen
