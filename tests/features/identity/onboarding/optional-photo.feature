# Pending: the photo-upload pipeline (signed upload URL → photo island
# dataset → form payload) is stubbed — the `I upload a profile photo`
# step is a placeholder. Un-pend when the upload-fixture seam lands and
# the dashboard renders the uploaded image against real markup.
@pending @domain-onboarding
Feature: Profile photo is optional at onboarding

  AC-9 and AC-10 require that the profile-photo upload at onboarding
  is non-blocking: a user who skips it reaches the dashboard with a
  placeholder initials avatar, and a user who uploads one sees that
  photo on the dashboard immediately. Upload pipeline shape (signed
  URL handshake, file-size guard, persisted asset id) lives at the
  contract tier; these scenarios assert only the user-visible result.

  @ac-9
  Scenario: Onboarding without a photo shows the initials-avatar placeholder
    Given I am signed in as "athlete"
    And I have not yet completed onboarding
    When I open the onboarding screen
    And my primary email becomes verified
    And I complete the onboarding profile fields
    And I attest that I am at least 13 years old
    And I accept the Terms of Service
    And I accept the Privacy Policy
    And I skip uploading a profile photo
    And I submit the onboarding form
    Then I see the dashboard surface
    And I see an initials-avatar placeholder

  @ac-10
  Scenario: Onboarding with a photo shows the uploaded photo on the dashboard
    Given I am signed in as "athlete"
    And I have not yet completed onboarding
    When I open the onboarding screen
    And my primary email becomes verified
    And I complete the onboarding profile fields
    And I attest that I am at least 13 years old
    And I accept the Terms of Service
    And I accept the Privacy Policy
    And I upload a profile photo
    And I submit the onboarding form
    Then I see the dashboard surface
    And I see my uploaded profile photo on the dashboard
