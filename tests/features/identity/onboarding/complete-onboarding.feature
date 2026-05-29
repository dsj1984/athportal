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

  # Traceability (Story #1025): the just-in-time user-provisioning
  # journey (Test Plan tp-identity-jit-provisioning) is a fresh,
  # never-provisioned user whose first authenticated request lands them
  # on the onboarding gate — the user-visible face of the JIT row being
  # created with `onboardingCompleted=false`. The idempotency invariant
  # (no duplicate row on a second authenticated request, dashboard on
  # re-authentication after completion) lives in the contract tier.
  @pending @issue-997 @ac-5
  Scenario: A freshly provisioned user is taken to onboarding on first sign-in
    Given I am a freshly created test user with a verified email
    When I open the onboarding screen
    Then I see the onboarding screen
    When I complete the onboarding profile fields
    And I attest that I am at least 13 years old
    And I accept the Terms of Service
    And I accept the Privacy Policy
    And I submit the onboarding form
    Then I see the dashboard surface

  # Traceability (Story #1025): the coach sign-up → onboarding journey
  # (Test Plan tp-identity-signup-coach) and the role-assignment journey
  # (Test Plan tp-identity-role-assignment, coach leg) — selecting the
  # coach persona at onboarding records the coach role and lands the user
  # on the coach-scoped surface, not the athlete dashboard.
  @pending @issue-997 @ac-5 @persona-coach
  Scenario: Coach completes onboarding and lands on the team-management surface
    Given I am signed in as "coach"
    And I have not yet completed onboarding
    When I open the onboarding screen
    And my primary email becomes verified
    And I complete the onboarding profile fields
    And I select the "coach" persona during onboarding
    And I attest that I am at least 13 years old
    And I accept the Terms of Service
    And I accept the Privacy Policy
    And I submit the onboarding form
    Then I see the "team management" surface

  # Traceability (Story #1025): the org-admin sign-up → onboarding journey
  # (Test Plan tp-identity-signup-org-admin) and the role-assignment
  # journey (Test Plan tp-identity-role-assignment, org-admin leg) —
  # selecting the org-admin persona at onboarding records the org-admin
  # role and lands the user on the organization-management surface.
  @pending @issue-997 @ac-5 @persona-org-admin
  Scenario: Org admin completes onboarding and lands on the organization-management surface
    Given I am signed in as "org admin"
    And I have not yet completed onboarding
    When I open the onboarding screen
    And my primary email becomes verified
    And I complete the onboarding profile fields
    And I select the "org admin" persona during onboarding
    And I attest that I am at least 13 years old
    And I accept the Terms of Service
    And I accept the Privacy Policy
    And I submit the onboarding form
    Then I see the "organization management" surface
