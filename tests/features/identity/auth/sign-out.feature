@pending @domain-auth
Feature: Athlete signs out of the Athlete Portal

  Signing out is a deliberate, user-initiated transition back to the
  anonymous surface. AC-4 asserts the two halves of that transition the
  athlete actually perceives: they land on the public surface, and the
  protected pages they were just on are no longer reachable without
  signing back in. Cookie clearing and `/sign-out` request shape live at
  the contract tier.

  @smoke @ac-4
  Scenario: Athlete signs out
    Given I am signed in as "athlete"
    And I am viewing my athlete dashboard
    When I sign out
    Then I see the public welcome surface
    And I cannot reach my athlete dashboard without signing in
