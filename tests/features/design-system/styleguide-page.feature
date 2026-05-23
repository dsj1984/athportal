@skip @epic-702 @domain::design-system
Feature: Live styleguide page

  The live styleguide page at /_internal/styleguide is visible to
  dev_admin users only. Anonymous visitors and authenticated
  non-dev-admin users are redirected away (or get a 404).

  Scenario: Dev admin sees the live styleguide page
    Given I am signed in as "dev admin"
    When I visit the live styleguide page
    Then I see a live reference page organised into Foundations, Interactive atoms, Display atoms, and Composites with every shipped primitive visible

  Scenario: Anonymous visitor cannot view the styleguide
    Given I am not signed in
    When I visit the live styleguide page
    Then I am redirected away from the styleguide and never see its content

  Scenario: Authenticated non-dev-admin user cannot view the styleguide
    Given I am signed in as "athlete"
    When I visit the live styleguide page
    Then I am redirected away from the styleguide and never see its content
