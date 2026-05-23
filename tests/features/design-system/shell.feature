@skip @epic-702 @domain::design-system
Feature: Shell navigation chrome

  The Shell composite renders the Sidebar and Topbar with the canonical
  nav set for the current persona and switches the nav set when the
  persona changes.

  Scenario: Shell renders the athlete persona
    Given I am a contributor mounting the Shell with the persona set to athlete
    When I view the page
    Then I see the navigation chrome render with the canonical athlete nav items and active-state styling

  Scenario: Shell renders the coach persona
    Given I am a contributor mounting the Shell with the persona set to coach
    When I view the page
    Then I see the navigation chrome render with the canonical coach nav items and active-state styling

  Scenario: Shell renders the org admin persona
    Given I am a contributor mounting the Shell with the persona set to org admin
    When I view the page
    Then I see the navigation chrome render with the canonical org admin nav items and active-state styling
