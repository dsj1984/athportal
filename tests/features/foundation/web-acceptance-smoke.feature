@smoke @ac-4
Feature: Web acceptance runner smoke

  The acceptance tier is wired end-to-end. A first-time visitor lands on
  the public welcome page and sees the application's welcome banner, proving
  bddgen + Playwright execute against the repo-root corpus on every viewport
  the runner is configured for.

  Scenario: A first-time visitor sees the welcome banner
    Given I am a first-time visitor to the public welcome page
    When I open the welcome page
    Then I see the welcome banner
