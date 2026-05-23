@skip @epic-702 @domain::design-system
Feature: Badge primitive

  The Badge primitive renders every tone as a soft translucent pill and
  surfaces the optional dot indicator when requested.

  Scenario: Badge renders every tone as a soft pill
    Given I am a contributor with the Badge primitive imported on a page
    When I render the brand, cyan, lime, amber, coral, and slate tones
    Then I see each tone rendered as a soft translucent pill and never on a solid-dark background

  Scenario: Badge dot is rendered when requested
    Given I am a contributor with the Badge primitive imported on a page
    When I render a Badge with the optional dot indicator enabled
    Then I see the dot indicator on the Badge
