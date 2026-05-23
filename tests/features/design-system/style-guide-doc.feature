@skip @epic-702 @domain::design-system
Feature: Style guide documentation reflects the design system

  The repo style-guide document reflects the extended token catalogue
  in its foundations sections, retains every prior Epic amendment
  verbatim, and links the live in-app styleguide page as the canonical
  live reference.

  Scenario: Style guide reflects the extended token catalogue
    Given I am a contributor opening the repo style guide document
    When I read the foundations sections
    Then I see the radii scale, shadow scale, text-tertiary, border-strong, action-amber, and font-mono tokens documented and the thirteen prior Epic amendments still visible verbatim

  Scenario: Style guide links the live styleguide page
    Given I am a contributor opening the repo style guide document
    When I read the section near the top of the document
    Then I see a link to the live styleguide page documented as the canonical live reference
