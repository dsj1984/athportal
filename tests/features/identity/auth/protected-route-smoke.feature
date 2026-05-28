@pending @issue-997 @domain-auth
Feature: Each persona reaches their own protected surface

  Every persona has one protected surface that is theirs and no one
  else's. AC-8 through AC-11 pin that mapping at the user-visible
  surface — sign in as the persona, land on the surface, see the
  identifying content. The per-persona Playwright projects (wired by
  Story #329) route each scenario to its matching cached
  `storageState`; the contract suite covers cookie flags, JIT
  provisioning, and role-gated access wire shape.

  @smoke @ac-8 @persona-athlete
  Scenario: Athlete sees their dashboard
    Given I am signed in as "athlete"
    When I open my athlete dashboard
    Then I see the "athlete dashboard" surface

  @smoke @ac-9 @persona-coach
  Scenario: Coach sees their team-management surface
    Given I am signed in as "coach"
    When I open my team-management surface
    Then I see the "team management" surface

  @smoke @ac-10 @persona-org-admin
  Scenario: Org admin sees their organization-management surface
    Given I am signed in as "org admin"
    When I open my organization-management surface
    Then I see the "organization management" surface

  @smoke @ac-11 @persona-dev-admin
  Scenario: Dev admin sees the platform-admin surface
    Given I am signed in as "dev admin"
    When I open the platform-admin surface
    Then I see the "platform admin" surface
