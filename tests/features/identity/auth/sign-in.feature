@pending @issue-997 @domain-auth
Feature: Athlete signs in to the Athlete Portal

  The sign-in surface is the front door to every protected area of the
  Athlete Portal. AC-1 covers email + password — the default credential
  shape for athletes who self-register — and AC-2 covers magic link — the
  passwordless alternative Clerk surfaces alongside it. Both paths land
  the athlete on their own protected surface and show their own content.
  Wire shape, cookie flags, and session-restore semantics live at the
  contract tier; this file asserts only what the athlete sees.

  @smoke @ac-1
  Scenario: Athlete signs in with email and password
    Given I am not signed in
    When I sign in as an athlete with email and password
    Then I see my athlete dashboard

  @smoke @ac-2
  Scenario: Athlete signs in with a magic link
    Given I am not signed in
    When I sign in as an athlete with a magic link
    Then I see my athlete dashboard
