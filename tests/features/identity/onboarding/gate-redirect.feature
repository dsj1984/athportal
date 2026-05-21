@pending @domain-onboarding
Feature: The onboarding gate redirects un-onboarded users

  Server-enforced onboarding (Epic #8) requires that any signed-in user
  whose onboarding completion timestamp is still unstamped is routed to
  the onboarding screen on every protected surface, while a user who has
  already completed onboarding reaches the surface they requested. The
  scenarios below name the user-visible navigation outcome. Redirect
  status codes, target paths, and the unstamped-timestamp check live at
  the contract tier (Story #562 middleware, Story #563 API gate).

  @smoke @ac-1
  Scenario: Un-onboarded user is redirected to onboarding on a protected route
    Given I am signed in as "athlete"
    And I have not yet completed onboarding
    When I open the dashboard page
    Then I see the onboarding screen

  # Pending: the Astro middleware's `productionLookup` is still the
  # safe-default placeholder that treats every signed-in user as
  # "no row found → redirect". An onboarded persona cannot pass the
  # gate until the web runtime carries a real DB handle binding (Tech
  # Spec #490 §Architecture; the matching cutover lands with a later
  # Wave that wires the DB into Astro.locals). Un-pend this scenario
  # together with that wave.
  @pending @ac-2
  Scenario: Onboarded user reaches a protected route without redirect
    Given I am signed in as "athlete"
    And I have already completed onboarding
    When I open the dashboard page
    Then I see the dashboard surface

  @smoke @ac-15
  Scenario: Direct dashboard navigation is intercepted by the onboarding gate
    Given I am signed in as "athlete"
    And I have not yet completed onboarding
    When I navigate directly to the dashboard surface
    Then I see the onboarding screen
