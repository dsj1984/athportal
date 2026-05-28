@pending @issue-997 @domain-auth
Feature: Reloading a protected page preserves the athlete's session

  Session restore is what makes the Athlete Portal feel persistent across
  reloads, tab restores, and brief network blips. AC-3 asserts the
  user-visible side of that contract: after a successful sign-in, hitting
  refresh leaves the athlete on the same protected surface with the same
  identity. Cookie flags and JWT lifetime decisions live in the contract
  suite; this scenario asserts only the visible outcome.

  @smoke @ac-3
  Scenario: Reloading a protected page keeps the athlete signed in
    Given I am signed in as "athlete"
    And I am viewing my athlete dashboard
    When I reload the page
    Then I see my athlete dashboard
